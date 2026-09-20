import {migrate} from 'drizzle-orm/node-postgres/migrator';
import OpenAI from 'openai';
import {Pool} from 'pg';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {configSchema} from '../config.ts';
import {createDatabase} from '../db/index.ts';
import {sources, tags} from '../db/schema.ts';
import {createGooglePlaces} from '../services/google/index.ts';
import * as instagram from '../services/instagram/index.ts';

import {
  importPayload as googleImportPayload,
  importQueue as googleQueue,
} from './gmaps-import.ts';
import {startJobs} from './index.ts';
import {
  type InstagramImportDependencies,
  enqueueInstagramImport,
  importInstagramPost,
  importQueue,
  registerInstagramImportWorker,
} from './instagram-import.ts';

vi.mock('../services/instagram/index.ts', async importOriginal => ({
  ...(await importOriginal<typeof instagram>()),
  scrapeInstagramPost: vi.fn(),
  prepareInstagramPost: vi.fn(),
  capture: vi.fn(),
}));

const testUrl = process.env.TEST_DATABASE_URL;
const shortcode = 'ExamplePost';
const url = `https://www.instagram.com/p/${shortcode}/`;
const metadata = {
  externalId: 'ExamplePost',
  caption: 'Two neighborhood cafes',
  username: 'creator',
  postedAt: '2026-09-01T12:00:00.000Z',
  thumbnailUrl: 'https://cdn.example/cover.jpg',
};

describe.skipIf(!testUrl)('Instagram ingestion with PostgreSQL and pg-boss', () => {
  const databaseName = `places_instagram_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const databaseUrl = new URL(testUrl ?? 'postgres://localhost/places');
  databaseUrl.pathname = `/${databaseName}`;
  const db = createDatabase(databaseUrl.href);
  const config = configSchema.parse({
    database: {url: databaseUrl.href},
    openai: {key: 'test'},
    instagram: {
      alwaysApplyTags: ['needs-review', 'imported'],
      excludedNamespaces: ['rating'],
      excludedTags: ['favorite', 'needs-review'],
      requiredNamespaces: [],
      capture: {model: 'test'},
    },
  });
  let jobs: Awaited<ReturnType<typeof startJobs>>;
  let dependencies: InstagramImportDependencies;
  let captured: instagram.CaptureResult;
  let reviewTagId: string;
  let importedTagId: string;
  const dispose = vi.fn(async () => {});

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    jobs = await startJobs(databaseUrl.href);
    dependencies = {
      db,
      google: createGooglePlaces(),
      openai: new OpenAI({apiKey: config.openai.key}),
      ffmpeg: instagram.createFFmpeg(),
      config: config.instagram,
    };
  }, 30000);

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await jobs.deleteAllJobs(googleQueue);
    await jobs.deleteAllJobs(importQueue);
    await db.delete(sources);
    await db.delete(tags);
    const [tag, imported] = await db
      .insert(tags)
      .values([{name: 'needs-review'}, {name: 'imported'}])
      .returning();
    importedTagId = imported!.id;
    reviewTagId = tag!.id;
    captured = {
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
    vi.mocked(instagram.scrapeInstagramPost).mockResolvedValue({...metadata, media: []});
    vi.mocked(instagram.prepareInstagramPost).mockResolvedValue({
      ...metadata,
      media: [],
      [Symbol.asyncDispose]: dispose,
    });
    vi.mocked(instagram.capture).mockImplementation(() => {
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
    const result = await importInstagramPost(jobs, dependencies, shortcode);
    expect(result).toMatchObject({skipped: false, unresolved: captured.unresolved});
    expect(result.jobIds).toHaveLength(2);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(instagram.scrapeInstagramPost).toHaveBeenCalledWith(url, {
      signal: expect.any(AbortSignal),
    });
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
    expect(instagram.capture).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        tags: expect.arrayContaining([expect.objectContaining({id: reviewTagId})]),
      }),
      {
        ...config.instagram.capture,
        excludedTags: ['favorite', 'needs-review', 'imported'],
        excludedNamespaces: ['rating'],
        requiredNamespaces: [],
      },
      expect.any(AbortSignal),
    );
  });

  it('supports an empty list of automatic tags', async () => {
    await importInstagramPost(
      jobs,
      {...dependencies, config: {...dependencies.config, alwaysApplyTags: []}},
      shortcode,
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
    expect(await importInstagramPost(jobs, dependencies, shortcode)).toMatchObject({
      sourceId: source!.id,
      skipped: true,
      jobIds: [],
    });
    expect(instagram.scrapeInstagramPost).not.toHaveBeenCalled();
    expect(instagram.prepareInstagramPost).not.toHaveBeenCalled();
    expect(instagram.capture).not.toHaveBeenCalled();
  });

  it('rolls back source and queued jobs together and permits a retry', async () => {
    const insert = jobs.insert.bind(jobs);
    vi.spyOn(jobs, 'insert').mockImplementationOnce(async (...args) => {
      await insert(...args);
      expect(await db.select().from(sources)).toEqual([]);
      expect(await jobs.findJobs(googleQueue)).toEqual([]);
      throw new Error('Dispatch failed before commit');
    });
    await expect(importInstagramPost(jobs, dependencies, shortcode)).rejects.toThrow(
      'Dispatch failed',
    );
    expect(await db.select().from(sources)).toEqual([]);
    expect(await jobs.findJobs(googleQueue)).toEqual([]);
    dispose.mockClear();
    expect(await importInstagramPost(jobs, dependencies, shortcode)).toMatchObject({
      skipped: false,
    });
    expect(await jobs.findJobs(googleQueue)).toHaveLength(2);
  });

  it('retains a source and unresolved mentions when no places match', async () => {
    captured.places = [];
    const insert = vi.spyOn(jobs, 'insert');
    expect(await importInstagramPost(jobs, dependencies, shortcode)).toMatchObject({
      jobIds: [],
      unresolved: captured.unresolved,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(await db.select().from(sources)).toHaveLength(1);
  });

  it('rejects a missing automatic tag before making paid provider calls', async () => {
    await db.delete(tags);
    await expect(importInstagramPost(jobs, dependencies, shortcode)).rejects.toThrow(
      'automatic tag does not exist',
    );
    expect(instagram.scrapeInstagramPost).not.toHaveBeenCalled();
  });

  it('disposes media after capture failures without creating a source', async () => {
    vi.mocked(instagram.capture).mockRejectedValueOnce(new Error('Capture failed'));
    await expect(importInstagramPost(jobs, dependencies, shortcode)).rejects.toThrow(
      'Capture failed',
    );
    expect(dispose).toHaveBeenCalledOnce();
    expect(await db.select().from(sources)).toEqual([]);
  });

  it('dispatches only once if concurrent captures reach source creation', async () => {
    vi.mocked(instagram.capture).mockResolvedValue(captured);
    const results = await Promise.all([
      importInstagramPost(jobs, dependencies, shortcode),
      importInstagramPost(jobs, dependencies, shortcode),
    ]);
    expect(results.map(result => result.skipped).toSorted()).toEqual([false, true]);
    expect(await db.select().from(sources)).toHaveLength(1);
    expect(await jobs.findJobs(googleQueue)).toHaveLength(2);
  });

  it('deduplicates different share URLs for the same queued post', async () => {
    const first = await enqueueInstagramImport(jobs, url);
    const duplicate = await enqueueInstagramImport(
      jobs,
      'https://instagram.com/reel/ExamplePost/?igsh=test',
    );
    expect(first).toEqual(expect.any(String));
    expect(duplicate).toBeNull();
    const queued = await jobs.findJobs(importQueue);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.data).toEqual({shortcode});
  });

  it('registers a worker that captures and dispatches queued posts', async () => {
    await registerInstagramImportWorker(jobs, dependencies, config.workers[importQueue]);
    try {
      const id = await enqueueInstagramImport(jobs, url);
      await vi.waitFor(
        async () => {
          const [job] = await jobs.findJobs(importQueue, {id: id!});
          expect(job?.state).toBe('completed');
          expect(job?.output).toMatchObject({skipped: false, jobIds: expect.any(Array)});
        },
        {timeout: 15000, interval: 100},
      );
    } finally {
      await jobs.offWork(importQueue);
    }
  });
});
