import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {eq, sql} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Pool} from 'pg';
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {createApp} from '../app.ts';
import {configSchema} from '../config.ts';
import {isUniqueViolation} from '../db/errors.ts';
import {createDatabase} from '../db/index.ts';
import {places, placeTags, tags} from '../db/schema.ts';
import {testConfig} from '../fixtures/config.ts';
import {createGooglePlaces} from '../services/google/index.ts';

import {registerSyncWorker, syncPlace, syncQueue} from './gmaps-sync.ts';
import {startJobs} from './index.ts';

const testUrl = process.env.TEST_DATABASE_URL;
const details = {
  id: 'test',
  displayName: {text: 'Refreshed cafe'},
  formattedAddress: 'New York',
  googleMapsUri: 'https://maps.google.com/',
  location: {latitude: 40, longitude: -74},
  timeZone: 'America/New_York',
  businessStatus: 'OPERATIONAL',
  hoursWeeklyOpen: [
    [1980, 2160],
    [2220, 2460],
  ] as Array<[number, number]>,
};

describe.skipIf(!testUrl)('place sync with PostgreSQL and pg-boss', () => {
  const databaseName = `places_sync_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');
  url.pathname = `/${databaseName}`;
  const db = createDatabase(url.href);
  const google = {
    ...createGooglePlaces(),
    getMetadata: vi.fn().mockResolvedValue(details),
  };
  const config = configSchema.parse({
    ...testConfig,
    database: {url: url.href},
    google: {apiKey: 'test'},
  });
  let jobs: Awaited<ReturnType<typeof startJobs>>;
  let client: Client;
  let placeId: string;

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    jobs = await startJobs(url.href);
    const app = createApp({db, jobs, google, config});
    client = createORPCClient(
      new RPCLink({
        url: 'http://localhost/rpc',
        fetch: request => Promise.resolve(app.fetch(request)),
      }),
    );
  }, 30000);

  beforeEach(async () => {
    await jobs.deleteAllJobs(syncQueue);
    await db.delete(places);
    await db.delete(tags);
    google.getMetadata.mockReset().mockResolvedValue(details);
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: 'test',
        name: 'Original cafe',
        formattedAddress: 'Old address',
        coordinates: 'SRID=4326;POINT(-73 41)',
        userNote: 'Keep this note',
      })
      .returning();
    placeId = place!.id;
  });

  afterAll(async () => {
    await jobs?.stop();
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  const read = async () => {
    const [saved] = await db.select().from(places).where(eq(places.id, placeId));
    return saved!;
  };

  it('updates provider fields, round-trips ranges, and preserves annotations', async () => {
    const [tag] = await db.insert(tags).values({name: 'favorite'}).returning();
    await db.insert(placeTags).values({placeId, tagId: tag!.id, note: 'Keep assignment'});
    expect(await syncPlace(db, google, placeId)).toEqual({placeId, status: 'updated'});
    expect(await read()).toMatchObject({
      name: 'Refreshed cafe',
      hoursWeeklyOpen: details.hoursWeeklyOpen,
      timeZone: details.timeZone,
      businessStatus: 'OPERATIONAL',
      lastSync: expect.any(Date),
      userNote: 'Keep this note',
    });
    const saved = await client.places.list();
    expect(saved[0]).toMatchObject({
      coordinates: details.location,
    });
    expect(await db.select().from(placeTags)).toEqual([
      expect.objectContaining({note: 'Keep assignment', placeId}),
    ]);
    const result = await db.execute(
      sql`select hours_weekly_open @> 2040 as open, hours_weekly_open @> int4range(2040, 2300, '[)') as spans_break from places where id = ${placeId}`,
    );
    expect(result.rows[0]).toEqual({open: true, spans_break: false});
  });

  it('advances last_sync on unchanged results and preserves updated_at', async () => {
    await syncPlace(db, google, placeId);
    const old = new Date('2020-01-01T00:00:00Z');
    await db.update(places).set({lastSync: old}).where(eq(places.id, placeId));
    const before = await read();
    expect(await syncPlace(db, google, placeId)).toMatchObject({status: 'unchanged'});
    const after = await read();
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.lastSync!.getTime()).toBeGreaterThan(old.getTime());
  });

  it('replaces a Google ID while preserving identity and annotations', async () => {
    await syncPlace(db, google, placeId);
    const before = await read();
    const [tag] = await db.insert(tags).values({name: 'favorite'}).returning();
    await db.insert(placeTags).values({placeId, tagId: tag!.id, note: 'Keep assignment'});
    google.getMetadata.mockResolvedValue({...details, id: 'replacement'});

    expect(await syncPlace(db, google, placeId)).toEqual({placeId, status: 'updated'});
    expect(await read()).toMatchObject({
      id: placeId,
      googlePlaceId: 'replacement',
      userNote: before.userNote,
      createdAt: before.createdAt,
    });
    expect(await db.select().from(placeTags)).toEqual([
      expect.objectContaining({placeId, note: 'Keep assignment'}),
    ]);

    expect(await syncPlace(db, google, placeId)).toMatchObject({status: 'unchanged'});
    expect(google.getMetadata).toHaveBeenLastCalledWith('replacement');
  });

  it('rolls back an ID collision without changing either saved place', async () => {
    await syncPlace(db, google, placeId);
    await db.insert(places).values({
      googlePlaceId: 'replacement',
      name: 'Existing owner',
      formattedAddress: 'NY',
      coordinates: 'SRID=4326;POINT(-74 40)',
      userNote: 'Preserve owner',
    });
    const before = await db.select().from(places).orderBy(places.id);
    google.getMetadata.mockResolvedValueOnce({
      ...details,
      id: 'replacement',
      displayName: {text: 'Changed name'},
    });

    const error = await syncPlace(db, google, placeId).catch(error => error);
    expect(isUniqueViolation(error, 'places_google_place_id_unique')).toBe(true);
    expect(await db.select().from(places).orderBy(places.id)).toEqual(before);
  });

  it('preserves data on failures and clears unavailable fields after success', async () => {
    await syncPlace(db, google, placeId);
    const before = await read();
    google.getMetadata.mockRejectedValueOnce(new Error('upstream failed'));
    await expect(syncPlace(db, google, placeId)).rejects.toThrow();
    expect(await read()).toEqual(before);
    google.getMetadata.mockResolvedValueOnce({
      ...details,
      hoursWeeklyOpen: null,
      timeZone: null,
      businessStatus: 'CLOSED_PERMANENTLY',
    });
    await syncPlace(db, google, placeId);
    expect(await read()).toMatchObject({
      hoursWeeklyOpen: null,
      timeZone: null,
      businessStatus: 'CLOSED_PERMANENTLY',
    });
  });

  it('does not overwrite a sync that completed during an older fetch', async () => {
    const pending = Promise.withResolvers<typeof details>();
    google.getMetadata.mockReturnValueOnce(pending.promise);
    const first = syncPlace(db, google, placeId);
    await vi.waitFor(() => expect(google.getMetadata).toHaveBeenCalledOnce());
    await syncPlace(db, google, placeId);
    pending.resolve({...details, displayName: {text: 'Stale'}});
    expect(await first).toMatchObject({status: 'superseded'});
    const saved = await read();
    expect(saved.name).toBe('Refreshed cafe');
  });

  it('handles deleted places and enforces weekly range bounds', async () => {
    expect(await syncPlace(db, google, randomUUID())).toMatchObject({status: 'missing'});
    expect(google.getMetadata).not.toHaveBeenCalled();
    await expect(
      db
        .update(places)
        .set({hoursWeeklyOpen: [[0, 10081]]})
        .where(eq(places.id, placeId)),
    ).rejects.toThrow();
    await db.update(places).set({hoursWeeklyOpen: []}).where(eq(places.id, placeId));
    const saved = await read();
    expect(saved.hoursWeeklyOpen).toEqual([]);
  });

  it('filters selection and deduplicates jobs before any provider calls', async () => {
    await db.insert(places).values({
      googlePlaceId: 'other',
      name: 'Bakery',
      formattedAddress: 'NY',
      coordinates: 'SRID=4326;POINT(-74 40)',
    });
    expect(await client.places.sync({query: 'name[missing]'})).toMatchObject({
      matched: 0,
      queued: 0,
    });
    await expect(client.places.sync({query: 'notAFilter[x]'})).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    const result = await client.places.sync({query: 'name[cafe]'});
    expect(result).toMatchObject({matched: 1, queued: 1, alreadyQueued: 0});
    const job = await jobs.getJobById(syncQueue, result.jobIds[0]!);
    expect(job?.data).toEqual({
      placeId,
    });
    expect(await client.places.sync()).toMatchObject({
      matched: 2,
      queued: 1,
      alreadyQueued: 1,
    });
    expect(google.getMetadata).not.toHaveBeenCalled();
    expect(await client.places.syncStatus({jobId: result.jobIds[0]!})).toMatchObject({
      state: 'created',
      result: null,
    });
    await expect(client.places.syncStatus({jobId: randomUUID()})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('runs queued jobs and exposes their result', async () => {
    const {jobIds} = await client.places.sync();
    await registerSyncWorker(jobs, {db, google}, config.workers[syncQueue]);
    await vi.waitFor(
      async () => {
        expect(await client.places.syncStatus({jobId: jobIds[0]!})).toMatchObject({
          state: 'completed',
          result: 'updated',
          placeId,
        });
      },
      {timeout: 15000, interval: 100},
    );
    await jobs.offWork(syncQueue);
  }, 20000);
});
