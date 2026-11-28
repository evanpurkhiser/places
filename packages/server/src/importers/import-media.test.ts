import {instagramSourceData} from '@places/common/contract/source';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import OpenAI from 'openai';
import {Pool} from 'pg';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {mediaImportConfig} from '../config/media-import.ts';
import {createDatabase} from '../db/index.ts';
import {importRuns, sources, tags} from '../db/schema.ts';
import {
  importPayload as googleImportPayload,
  importQueue as googleQueue,
} from '../jobs/gmaps-import.ts';
import {startJobs} from '../jobs/index.ts';
import {createGooglePlaces} from '../services/google/index.ts';
import * as media from '../services/media-import/index.ts';

import {importMediaPost, type MediaImportDependencies} from './import-media.ts';

vi.mock('../services/media-import/index.ts', async importOriginal => ({
  ...(await importOriginal<typeof media>()),
  prepareMediaPost: vi.fn(),
  capture: vi.fn(),
}));

const testUrl = process.env.TEST_DATABASE_URL;
const url = 'https://example.com/posts/cafes';
const sourceData = {
  caption: 'Two neighborhood cafes',
  username: 'creator',
  postedAt: '2026-09-01T12:00:00.000Z',
  thumbnailUrl: 'https://cdn.example.com/cover.jpg',
};
const metadata = {externalId: 'neighborhood-cafes', ...sourceData};
const provider = {
  type: 'instagram' as const,
  name: 'Example provider',
  postDescription: 'a cafe recommendation post',
  sourceData: () => instagramSourceData.parse(sourceData),
};
const post = {
  externalId: metadata.externalId,
  url,
  load: vi.fn<(signal: AbortSignal) => Promise<media.MediaPostSource>>(),
};

describe.skipIf(!testUrl)('Media import with PostgreSQL and pg-boss', () => {
  const databaseName = `places_media_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const databaseUrl = new URL(testUrl ?? 'postgres://localhost/places');
  databaseUrl.pathname = `/${databaseName}`;
  const db = createDatabase(databaseUrl.href);
  const config = mediaImportConfig.parse({
    alwaysApplyTags: ['needs-review', 'imported'],
    excludedNamespaces: ['rating'],
    excludedTags: ['favorite', 'needs-review'],
    requiredNamespaces: [],
    capture: {model: 'test'},
  });
  const dependencies: MediaImportDependencies = {
    db,
    google: createGooglePlaces(),
    openai: new OpenAI({apiKey: 'test'}),
    ffmpeg: media.createFFmpeg(),
    config,
  };
  let jobs: Awaited<ReturnType<typeof startJobs>>;
  let captured: media.CaptureResult;
  let reviewTagId: string;
  let importedTagId: string;
  const dispose = vi.fn(async () => {});

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    jobs = await startJobs(databaseUrl.href);
  }, 30000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await jobs.deleteAllJobs(googleQueue);
    await db.delete(importRuns);
    await db.delete(sources);
    await db.delete(tags);
    const [tag, imported] = await db
      .insert(tags)
      .values([{name: 'needs-review'}, {name: 'imported'}])
      .returning();
    importedTagId = imported!.id;
    reviewTagId = tag!.id;
    captured = {
      metadata: {
        version: 1,
        model: 'test',
        prompt: 'Test prompt',
        searches: [],
        usage: {requests: 1, inputTokens: 10, outputTokens: 10, totalTokens: 20},
        options: {
          ...config.capture,
          excludedTags: [],
          excludedNamespaces: [],
          requiredNamespaces: [],
        },
      },
      source: {...metadata, description: 'A guide to two neighborhood cafes.'},
      places: ['first', 'second'].map(googlePlaceId => ({
        googlePlaceId,
        name: googlePlaceId,
        formattedAddress: 'NYC',
        googleMapsUrl: 'https://maps.google.com/',
        coordinates: {latitude: 40, longitude: -74},
        tagIds: [reviewTagId],
        description: `Visit ${googlePlaceId}`,
        evidence: 'Caption',
        matchReason: 'Exact name and address',
      })),
      unresolved: [{name: 'Unknown cafe', reason: 'No identifying details'}],
    };
    post.load.mockResolvedValue({...metadata, media: []});
    vi.mocked(media.prepareMediaPost).mockResolvedValue({
      ...metadata,
      media: [],
      [Symbol.asyncDispose]: dispose,
    });
    vi.mocked(media.capture).mockImplementation(() => {
      expect(dispose).not.toHaveBeenCalled();
      return Promise.resolve(captured);
    });
  });

  afterAll(async () => {
    await jobs?.stop();
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('saves the source and dispatches all recommendations in one bulk insert', async () => {
    const insert = vi.spyOn(jobs, 'insert');
    const result = await importMediaPost(jobs, dependencies, provider, post);
    expect(result).toMatchObject({skipped: false, unresolved: captured.unresolved});
    expect(result.jobIds).toHaveLength(2);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(post.load).toHaveBeenCalledExactlyOnceWith(expect.any(AbortSignal));
    expect(dispose).toHaveBeenCalledOnce();
    expect(await db.select().from(sources)).toMatchObject([
      {
        id: result.sourceId,
        type: 'instagram',
        externalId: metadata.externalId,
        url,
        description: captured.source.description,
        data: {caption: metadata.caption, username: metadata.username},
      },
    ]);
    const children = await jobs.findJobs(googleQueue);
    const payloads = children.map(job => googleImportPayload.parse(job.data));
    expect(payloads.map(payload => payload.googlePlaceId).sort()).toEqual([
      'first',
      'second',
    ]);
    expect(
      payloads.every(
        payload =>
          payload.tags.length === 2 &&
          payload.tags.some(tag => tag.tagId === reviewTagId) &&
          payload.tags.some(tag => tag.tagId === importedTagId),
      ),
    ).toBe(true);
    expect(payloads[0]!.source).toMatchObject({
      sourceId: result.sourceId,
      data: {evidence: 'Caption'},
    });
    expect(media.capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        tags: expect.arrayContaining([expect.objectContaining({id: reviewTagId})]),
      }),
      {
        ...config.capture,
        excludedTags: ['favorite', 'needs-review', 'imported'],
        excludedNamespaces: ['rating'],
        requiredNamespaces: [],
      },
      expect.any(AbortSignal),
      expect.objectContaining({name: provider.name}),
    );
  });

  it('supports an empty list of automatic tags', async () => {
    await importMediaPost(
      jobs,
      {...dependencies, config: {...dependencies.config, alwaysApplyTags: []}},
      provider,
      post,
    );
    const children = await jobs.findJobs(googleQueue);
    expect(children).toHaveLength(2);
    for (const job of children) {
      expect(googleImportPayload.parse(job.data).tags).toEqual([{tagId: reviewTagId}]);
    }
  });

  it('skips existing sources before scraping, preparation, or capture', async () => {
    const [source] = await db
      .insert(sources)
      .values({type: 'instagram', externalId: metadata.externalId})
      .returning();
    expect(await importMediaPost(jobs, dependencies, provider, post)).toMatchObject({
      sourceId: source!.id,
      skipped: true,
      jobIds: [],
    });
    expect(post.load).not.toHaveBeenCalled();
    expect(media.prepareMediaPost).not.toHaveBeenCalled();
    expect(media.capture).not.toHaveBeenCalled();
  });

  it('rolls back source and queued jobs together and permits a retry', async () => {
    const insert = jobs.insert.bind(jobs);
    vi.spyOn(jobs, 'insert').mockImplementationOnce(async (...args) => {
      await insert(...args);
      expect(await db.select().from(sources)).toEqual([]);
      expect(await jobs.findJobs(googleQueue)).toEqual([]);
      throw new Error('Dispatch failed before commit');
    });
    await expect(importMediaPost(jobs, dependencies, provider, post)).rejects.toThrow(
      'Dispatch failed',
    );
    expect(await db.select().from(sources)).toEqual([]);
    expect(await jobs.findJobs(googleQueue)).toEqual([]);
    dispose.mockClear();
    expect(await importMediaPost(jobs, dependencies, provider, post)).toMatchObject({
      skipped: false,
    });
    expect(await jobs.findJobs(googleQueue)).toHaveLength(2);
  });

  it('retains a source and unresolved mentions when no places match', async () => {
    captured.places = [];
    const insert = vi.spyOn(jobs, 'insert');
    expect(await importMediaPost(jobs, dependencies, provider, post)).toMatchObject({
      jobIds: [],
      unresolved: captured.unresolved,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(await db.select().from(sources)).toHaveLength(1);
  });

  it('rejects a missing automatic tag before making paid provider calls', async () => {
    await db.delete(tags);
    await expect(importMediaPost(jobs, dependencies, provider, post)).rejects.toThrow(
      'automatic tag does not exist',
    );
    expect(post.load).not.toHaveBeenCalled();
  });

  it('disposes media after capture failures without creating a source', async () => {
    vi.mocked(media.capture).mockRejectedValueOnce(new Error('Capture failed'));
    await expect(importMediaPost(jobs, dependencies, provider, post)).rejects.toThrow(
      'Capture failed',
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(await db.select().from(sources)).toEqual([]);
  });

  it('dispatches only once if concurrent captures reach source creation', async () => {
    vi.mocked(media.capture).mockResolvedValue(captured);
    const results = await Promise.all([
      importMediaPost(jobs, dependencies, provider, post),
      importMediaPost(jobs, dependencies, provider, post),
    ]);
    expect(results.map(result => result.skipped).toSorted()).toEqual([false, true]);
    expect(await db.select().from(sources)).toHaveLength(1);
    expect(await jobs.findJobs(googleQueue)).toHaveLength(2);
  });
});
