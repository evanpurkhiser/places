import {eq} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import OpenAI from 'openai';
import {Pool} from 'pg';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {configSchema} from '../config.ts';
import {createDatabase} from '../db/index.ts';
import {sources, users} from '../db/schema.ts';
import {testConfig} from '../fixtures/config.ts';
import {ImportUnavailableError} from '../importers/errors.ts';
import {enqueueImport, getImportStatus} from '../importers/index.ts';
import {createGooglePlaces} from '../services/google/index.ts';
import * as media from '../services/media-import/index.ts';

import {importQueue as googleQueue} from './gmaps-import.ts';
import {startJobs} from './index.ts';
import {importQueue, registerRedNoteImportWorker} from './rednote-import.ts';

vi.mock('../services/media-import/index.ts', async importOriginal => ({
  ...(await importOriginal<typeof media>()),
  capture: vi.fn(),
}));

const testUrl = process.env.TEST_DATABASE_URL;
const externalId = '6a22d82d000000001002d001';
const shortUrl = 'https://xhslink.com/o/ExampleLink';
const noteUrl = `https://www.rednote.com/discovery/item/${externalId}`;
const thumbnailUrl = 'https://sns-web-i10.rednotecdn.com/photo.jpg';

describe.skipIf(!testUrl)('RedNote imports with PostgreSQL and pg-boss', () => {
  const databaseName = `places_rednote_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const databaseUrl = new URL(testUrl ?? 'postgres://localhost/places');
  databaseUrl.pathname = `/${databaseName}`;
  const db = createDatabase(databaseUrl.href);
  const google = createGooglePlaces();
  const config = configSchema.parse({
    ...testConfig,
    database: {url: databaseUrl.href},
    rednote: {
      alwaysApplyTags: [],
      excludedNamespaces: [],
      excludedTags: [],
      requiredNamespaces: [],
      capture: {model: 'test-rednote'},
    },
  });
  let jobs: Awaited<ReturnType<typeof startJobs>>;
  let userId: string;
  const context = () => ({db, jobs, google, config, userId});

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    const [defaultUser] = await db.select().from(users).where(eq(users.isDefault, true));
    userId = defaultUser!.id;
    jobs = await startJobs(databaseUrl.href);
  }, 30000);

  afterAll(async () => {
    await jobs?.stop();
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('rejects an import when the provider is unconfigured', async () => {
    await expect(
      enqueueImport(shortUrl, {
        ...context(),
        config: {...config, rednote: undefined},
      }),
    ).rejects.toThrow(ImportUnavailableError);
    expect(await jobs.findJobs(importQueue)).toHaveLength(0);
  });

  it('imports a share link and reuses its source for a canonical link', async () => {
    const rednote = config.rednote!;
    vi.mocked(media.capture).mockResolvedValue({
      metadata: {
        version: 1,
        model: rednote.capture.model,
        options: {
          ...rednote.capture,
          excludedTags: [],
          excludedNamespaces: [],
          requiredNamespaces: [],
        },
        prompt: 'Test prompt',
        searches: [],
        usage: {requests: 1, inputTokens: 10, outputTokens: 10, totalTokens: 20},
      },
      source: {
        externalId,
        description: 'A Taipei cafe recommendation.',
        caption: 'Taipei cafes',
        postedAt: null,
        username: null,
        thumbnailUrl,
      },
      places: [
        {
          googlePlaceId: 'taipei-cafe',
          name: 'Taipei cafe',
          formattedAddress: 'Taipei',
          googleMapsUrl: 'https://maps.google.com/',
          coordinates: {latitude: 25, longitude: 121},
          tagIds: [],
          description: 'Try the coffee.',
          evidence: 'Caption',
          matchReason: 'Exact name and location',
        },
      ],
      unresolved: [],
    });
    const note = {
      noteId: externalId,
      type: 'normal',
      title: 'Taipei cafes',
      imageList: [{url: thumbnailUrl}],
    };
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {location: `${noteUrl}?xsec_token=share`},
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          `<script>window.__INITIAL_STATE__=${JSON.stringify({noteData: {data: {noteData: note}}})}</script>`,
        ),
      )
      .mockResolvedValueOnce(
        new Response('photo', {headers: {'content-type': 'image/jpeg'}}),
      );

    await registerRedNoteImportWorker(
      jobs,
      {
        db,
        google,
        openai: new OpenAI({apiKey: config.openai.key}),
        ffmpeg: media.createFFmpeg(),
        config: rednote,
      },
      config.workers[importQueue],
    );

    async function importAndWait(url: string) {
      const {jobId} = await enqueueImport(url, context());
      await vi.waitFor(
        async () => {
          const job = await jobs.getJobById(importQueue, jobId);
          expect(job?.state).toBe('completed');
        },
        {timeout: 15000, interval: 100},
      );
      return getImportStatus(jobId, context());
    }

    try {
      const first = await importAndWait(shortUrl);
      const repeat = await importAndWait(
        `https://www.xiaohongshu.com/explore/${externalId}`,
      );

      expect(await db.select().from(sources)).toEqual([
        expect.objectContaining({
          id: first.sourceId,
          type: 'rednote',
          externalId,
          url: noteUrl,
        }),
      ]);
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(media.capture).toHaveBeenCalledExactlyOnceWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({model: 'test-rednote', excludedTags: []}),
        expect.any(AbortSignal),
        expect.objectContaining({name: 'RedNote'}),
      );
      expect(await jobs.findJobs(googleQueue)).toHaveLength(1);
      expect(first).toMatchObject({importType: 'rednote', state: 'active'});
      expect(repeat).toMatchObject({
        importType: 'rednote',
        sourceId: first.sourceId,
        state: 'active',
      });
    } finally {
      fetch.mockRestore();
      await jobs.offWork(importQueue);
    }
  }, 35000);
});
