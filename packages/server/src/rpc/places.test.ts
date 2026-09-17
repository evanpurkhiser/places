import {serve} from '@hono/node-server';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {createApp} from '../app.ts';
import {configSchema} from '../config.ts';
import {createDatabase} from '../db/index.ts';
import {places, placeTags, tags} from '../db/schema.ts';
import {importPlace, importQueue, registerImportWorker} from '../jobs/gmaps-import.ts';
import {createGooglePlaces} from '../services/google/index.ts';

const exec = promisify(execFile);
const testUrl = process.env.TEST_DATABASE_URL;
const details = {
  id: 'ChIJtest',
  displayName: {text: 'Test Cafe'},
  formattedAddress: 'New York, NY',
  googleMapsUri: 'https://maps.google.com/?q=place_id:ChIJtest',
  location: {latitude: 40.72, longitude: -73.98},
};

describe.skipIf(!testUrl)('place import with PostgreSQL and pg-boss', () => {
  const databaseName = `places_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');

  url.pathname = `/${databaseName}`;

  const db = createDatabase(url.href);
  const jobs = new PgBoss(url.href);
  const config = configSchema.parse({database: {url: url.href}});
  const google = {...createGooglePlaces(), get: vi.fn().mockResolvedValue(details)};
  const app = createApp({db, jobs, google, config});
  const client: Client = createORPCClient(
    new RPCLink({
      url: 'http://localhost/rpc',
      fetch: request => Promise.resolve(app.fetch(request)),
    }),
  );

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    await jobs.start();
    await jobs.createQueue(importQueue, {retryLimit: 1, retryDelay: 0});
    await registerImportWorker(jobs, db, google);
  }, 30000);

  beforeEach(async () => {
    await db.delete(places);
    await db.delete(tags);
    google.get.mockReset().mockResolvedValue(details);
  });

  afterAll(async () => {
    await jobs.stop();
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  async function waitForState(jobId: string, state: 'completed' | 'failed') {
    await vi.waitFor(
      async () => {
        expect((await client.places.importStatus({jobId})).state).toBe(state);
      },
      {timeout: 15000, interval: 100},
    );

    return client.places.importStatus({jobId});
  }

  it('queues only the resolved ID, persists metadata, and exposes named coordinates', async () => {
    const submitted = await client.places.import({input: 'gmaps:ChIJtest'});
    const job = await jobs.getJobById(importQueue, submitted.jobId);

    expect(job?.data).toEqual({googlePlaceId: 'ChIJtest', tagIds: []});

    const result = await waitForState(submitted.jobId, 'completed');
    const saved = await client.places.list();

    expect(result.placeIds).toEqual([saved[0]?.id]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Test Cafe',
      formattedAddress: 'New York, NY',
      googleMapsUrl: details.googleMapsUri,
      coordinates: details.location,
    });
  }, 20000);

  it('reuses existing places and handles concurrent imports without duplicate rows', async () => {
    const [first, second] = await Promise.all([
      importPlace(db, google, 'ChIJtest'),
      importPlace(db, google, 'ChIJtest'),
    ]);

    expect(first).toEqual(second);
    expect(await client.places.list()).toHaveLength(1);
    google.get.mockClear();

    const submitted = await client.places.import({input: 'gmaps:ChIJtest'});

    expect((await waitForState(submitted.jobId, 'completed')).placeIds).toEqual(
      first.placeIds,
    );
    expect(google.get).not.toHaveBeenCalled();
  }, 20000);

  it('resolves names and IDs, deduplicates tags, and adds tags on reimport', async () => {
    const cafe = await client.tags.create({name: 'type:cafe'});
    const favorite = await client.tags.create({name: 'favorite'});
    const submitted = await client.places.import({
      input: 'gmaps:ChIJtest',
      tags: [' Type:CAFE ', cafe.id, cafe.id],
    });
    const result = await waitForState(submitted.jobId, 'completed');

    expect(await db.select().from(placeTags)).toMatchObject([
      {placeId: result.placeIds[0], tagId: cafe.id},
    ]);

    google.get.mockClear();
    const repeated = await client.places.import({
      input: 'gmaps:ChIJtest',
      tags: [cafe.id, favorite.id],
    });

    await waitForState(repeated.jobId, 'completed');
    expect((await db.select().from(placeTags)).map(row => row.tagId).sort()).toEqual(
      [cafe.id, favorite.id].sort(),
    );
    expect(google.get).not.toHaveBeenCalled();
  }, 20000);

  it('rejects unknown tag names and IDs before queuing', async () => {
    const send = vi.spyOn(jobs, 'send');

    try {
      for (const tag of ['missing', randomUUID()]) {
        await expect(
          client.places.import({input: 'gmaps:ChIJtest', tags: [tag]}),
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: `Tag not found: ${tag}`,
        });
      }

      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it('rolls back a new place if a tag was deleted before the worker runs', async () => {
    await expect(importPlace(db, google, 'ChIJtest', [randomUUID()])).rejects.toThrow();
    expect(await client.places.list()).toEqual([]);
  });

  it('retries transient metadata failures and eventually creates the place', async () => {
    google.get.mockRejectedValueOnce(new Error('temporary failure'));
    const submitted = await client.places.import({input: 'gmaps:ChIJtest'});

    await waitForState(submitted.jobId, 'completed');
    expect(google.get).toHaveBeenCalledTimes(2);
    expect(await client.places.list()).toHaveLength(1);
  }, 20000);

  it('leaves no partial place after permanent metadata failure', async () => {
    google.get.mockRejectedValue(new Error('provider unavailable'));
    const submitted = await client.places.import({input: 'gmaps:ChIJtest'});
    const result = await waitForState(submitted.jobId, 'failed');

    expect(result.placeIds).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(await client.places.list()).toEqual([]);
    await expect(
      client.places.import({input: 'https://evil.test/'}),
    ).rejects.toMatchObject({code: 'BAD_REQUEST'});
    await expect(client.places.importStatus({jobId: randomUUID()})).rejects.toMatchObject(
      {code: 'NOT_FOUND'},
    );
  }, 20000);

  it('imports and lists through the actual CLI', async () => {
    const server = serve({fetch: app.fetch, hostname: '127.0.0.1', port: 15189});
    const cliPath = fileURLToPath(new URL('../../../cli/src/main.ts', import.meta.url));
    const cli = (...args: string[]) =>
      exec(process.execPath, [cliPath, '--server', 'http://127.0.0.1:15189', ...args]);

    try {
      const tag = await client.tags.create({name: 'favorite'});
      const submitted = JSON.parse(
        (await cli('import', 'gmaps:ChIJtest', '--tag', tag.name, '--tag', tag.id))
          .stdout,
      );

      await waitForState(submitted.jobId, 'completed');
      expect(JSON.parse((await cli('import-status', submitted.jobId)).stdout).state).toBe(
        'completed',
      );
      expect(JSON.parse((await cli('list')).stdout)).toHaveLength(1);
      expect(await db.select().from(placeTags)).toMatchObject([{tagId: tag.id}]);
      await expect(cli('import', 'https://evil.test')).rejects.toMatchObject({code: 1});
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  }, 20000);
});
