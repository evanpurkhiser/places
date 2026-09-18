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
  timeZone: 'America/New_York',
  hoursWeeklyOpen: [
    [1980, 2160],
    [2220, 2460],
  ] as Array<[number, number]>,
  businessStatus: 'OPERATIONAL',
};

describe.skipIf(!testUrl)('place import with PostgreSQL and pg-boss', () => {
  const databaseName = `places_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');

  url.pathname = `/${databaseName}`;

  const db = createDatabase(url.href);
  const jobs = new PgBoss(url.href);
  const config = configSchema.parse({database: {url: url.href}});
  const google = {
    ...createGooglePlaces(),
    getMetadata: vi.fn().mockResolvedValue(details),
  };
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
    google.getMetadata.mockReset().mockResolvedValue(details);
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
        const status = await client.places.importStatus({jobId});
        expect(status.state).toBe(state);
      },
      {timeout: 15000, interval: 100},
    );

    return client.places.importStatus({jobId});
  }

  it('queues only the resolved ID, persists metadata, and exposes named coordinates', async () => {
    const submitted = await client.places.import({input: 'gmaps:ChIJtest'});
    const job = await jobs.getJobById(importQueue, submitted.jobId);

    expect(job?.data).toEqual({googlePlaceId: 'ChIJtest', tags: []});

    const result = await waitForState(submitted.jobId, 'completed');
    const saved = await client.places.list();

    expect(result.placeIds).toEqual([saved[0]?.id]);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: 'Test Cafe',
      formattedAddress: 'New York, NY',
      googleMapsUrl: details.googleMapsUri,
      coordinates: details.location,
      timeZone: details.timeZone,
      hoursWeeklyOpen: details.hoursWeeklyOpen,
      businessStatus: details.businessStatus,
      lastSync: expect.any(Date),
    });
  }, 20000);

  it('imports missing hours and refreshes canonical IDs without duplicate places', async () => {
    google.getMetadata.mockResolvedValue({
      ...details,
      id: 'canonical',
      timeZone: null,
      hoursWeeklyOpen: null,
      businessStatus: null,
    });
    const first = await importPlace(db, google, 'oldId');
    const repeated = await importPlace(db, google, 'anotherOldId');
    expect(repeated).toEqual(first);
    const saved = await client.places.list();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      googlePlaceId: 'canonical',
      timeZone: null,
      hoursWeeklyOpen: null,
      businessStatus: null,
      lastSync: expect.any(Date),
    });
  });

  it('reuses existing places and handles concurrent imports without duplicate rows', async () => {
    const [first, second] = await Promise.all([
      importPlace(db, google, 'ChIJtest'),
      importPlace(db, google, 'ChIJtest'),
    ]);

    expect(first).toEqual(second);
    expect(await client.places.list()).toHaveLength(1);
    google.getMetadata.mockClear();

    const submitted = await client.places.import({input: 'gmaps:ChIJtest'});

    const completed = await waitForState(submitted.jobId, 'completed');
    expect(completed.placeIds).toEqual(first.placeIds);
    expect(google.getMetadata).not.toHaveBeenCalled();
  }, 20000);

  it('lists every tag association with metadata and notes, including on filtered places', async () => {
    const {
      placeIds: [placeId],
    } = await importPlace(db, google, 'ChIJtest');
    const [untagged] = await db
      .insert(places)
      .values({
        googlePlaceId: 'untagged',
        name: 'Untagged',
        formattedAddress: '',
        coordinates: 'SRID=4326;POINT(-74 40)',
      })
      .returning();
    const cafe = await client.tags.create({
      name: 'type:cafe',
      icon: {emoji: '☕'},
      description: 'Coffee shops',
    });
    const favorite = await client.tags.create({name: 'favorite', icon: {emoji: '⭐'}});
    const cafeAssignment = await client.places.tag({
      placeId: placeId!,
      tag: cafe.id,
      notes: 'Order the espresso',
    });
    const favoriteAssignment = await client.places.tag({
      placeId: placeId!,
      tag: favorite.id,
    });

    const all = await client.places.list();
    expect(all).toHaveLength(2);
    expect(all.find(place => place.id === untagged!.id)?.tags).toEqual([]);

    const filtered = await client.places.list({query: 'tag[type:cafe]'});
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.tags).toEqual([
      {...favoriteAssignment, tag: favorite},
      {...cafeAssignment, tag: cafe},
    ]);
    expect(await client.places.list({query: 'name[missing]'})).toEqual([]);

    await client.tags.update({id: cafe.id, icon: {emoji: '🫖'}});
    const updatedPlaces = await client.places.list({query: 'tag[type:cafe]'});

    expect(updatedPlaces[0]?.tags[1]?.tag.icon).toEqual({emoji: '🫖'});
    await client.places.untag({placeId: placeId!, tag: favorite.id});
    const untaggedPlaces = await client.places.list({query: 'tag[type:cafe]'});

    expect(untaggedPlaces[0]?.tags).toHaveLength(1);
  });

  it('resolves names and IDs, deduplicates tags, and adds tags on reimport', async () => {
    const cafe = await client.tags.create({name: 'type:cafe'});
    const favorite = await client.tags.create({name: 'favorite'});
    const submitted = await client.places.import({
      input: 'gmaps:ChIJtest',
      tags: [{tag: ' Type:CAFE '}, {tag: cafe.id}, {tag: cafe.id}],
    });
    const result = await waitForState(submitted.jobId, 'completed');

    expect(await db.select().from(placeTags)).toMatchObject([
      {placeId: result.placeIds[0], tagId: cafe.id},
    ]);

    google.getMetadata.mockClear();
    const repeated = await client.places.import({
      input: 'gmaps:ChIJtest',
      tags: [{tag: cafe.id}, {tag: favorite.id}],
    });

    await waitForState(repeated.jobId, 'completed');
    const savedTags = await db.select().from(placeTags);
    expect(savedTags.map(row => row.tagId).sort()).toEqual([cafe.id, favorite.id].sort());
    expect(google.getMetadata).not.toHaveBeenCalled();
  }, 20000);

  it('applies tag notes, resolves aliases, and preserves, replaces, and clears them', async () => {
    const bathroom = await client.tags.create({name: 'attr:nice-bathroom'});
    const cafe = await client.tags.create({name: 'type:cafe'});

    for (const [tagNotes, expected] of [
      [
        [
          {tag: ' Attr:Nice-Bathroom ', note: 'Old'},
          {tag: bathroom.id, note: '  Code 1234\nDownstairs  '},
        ],
        '  Code 1234\nDownstairs  ',
      ],
      [[], '  Code 1234\nDownstairs  '],
      [[{tag: bathroom.name, note: 'Code 5678'}], 'Code 5678'],
      [[{tag: bathroom.id, note: ''}], null],
    ] as const) {
      const submitted = await client.places.import({
        input: 'gmaps:ChIJtest',
        tags: [{tag: cafe.name}, ...tagNotes, {tag: bathroom.id}],
        notes: 'General place note',
      });

      await waitForState(submitted.jobId, 'completed');
      const assignments = await db.select().from(placeTags);

      expect(assignments).toHaveLength(2);
      expect(assignments).toEqual(
        expect.arrayContaining([
          expect.objectContaining({tagId: bathroom.id, note: expected}),
          expect.objectContaining({tagId: cafe.id, note: null}),
        ]),
      );
      expect(await client.places.list()).toMatchObject([
        {userNote: 'General place note'},
      ]);
    }
  }, 60000);

  it('tags existing places, preserves and edits notes, and removes assignments idempotently', async () => {
    const {
      placeIds: [placeId],
    } = await importPlace(db, google, 'ChIJtest');
    const tag = await client.tags.create({name: 'attr:nice-bathroom'});
    const input = {placeId: placeId!, tag: tag.id};
    const first = await client.places.tag({...input, tag: ' Attr:Nice-Bathroom '});

    expect(first).toMatchObject({placeId, tagId: tag.id, note: null});

    for (const [notes, expected] of [
      ['  Code 1234\nDownstairs  ', '  Code 1234\nDownstairs  '],
      [undefined, '  Code 1234\nDownstairs  '],
      ['Code 5678', 'Code 5678'],
      ['', null],
    ]) {
      expect(await client.places.tag({...input, notes: notes ?? undefined})).toEqual({
        ...first,
        note: expected,
      });
      expect(await db.select().from(placeTags)).toHaveLength(1);
    }

    await client.places.tag({...input, notes: 'Removed with assignment'});
    expect(await client.places.untag({...input, tag: tag.name})).toEqual({
      placeId,
      tagId: tag.id,
      removed: true,
    });
    expect(await client.places.untag(input)).toEqual({
      placeId,
      tagId: tag.id,
      removed: false,
    });
    expect(await db.select().from(placeTags)).toEqual([]);
    expect(await client.tags.get({id: tag.id})).toMatchObject({id: tag.id});
    expect(await client.places.list()).toHaveLength(1);
    expect(await client.places.tag(input)).toMatchObject({note: null});
  });

  it('rejects missing places and tags for assignment commands', async () => {
    const {
      placeIds: [placeId],
    } = await importPlace(db, google, 'ChIJtest');
    const tag = await client.tags.create({name: 'favorite'});

    for (const action of [client.places.tag, client.places.untag]) {
      await expect(action({placeId: randomUUID(), tag: tag.name})).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });

      for (const missing of ['missing', randomUUID()]) {
        await expect(action({placeId: placeId!, tag: missing})).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
    }

    expect(await db.select().from(placeTags)).toEqual([]);
  });

  it('rejects unknown tag names and IDs before queuing', async () => {
    const send = vi.spyOn(jobs, 'send');

    try {
      for (const tag of ['missing', randomUUID()]) {
        await expect(
          client.places.import({input: 'gmaps:ChIJtest', tags: [{tag}]}),
        ).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: `Tag not found: ${tag}`,
        });
      }

      await expect(
        client.places.import({
          input: 'gmaps:ChIJtest',
          tags: [{tag: 'missing', note: 'Code'}],
        }),
      ).rejects.toMatchObject({code: 'BAD_REQUEST', message: 'Tag not found: missing'});

      expect(send).not.toHaveBeenCalled();
    } finally {
      send.mockRestore();
    }
  });

  it('saves, preserves, replaces, and clears notes on import', async () => {
    for (const [notes, expected] of [
      ['  First note\nSecond line  ', '  First note\nSecond line  '],
      [undefined, '  First note\nSecond line  '],
      ['Replacement note', 'Replacement note'],
      ['', null],
    ]) {
      const submitted = await client.places.import({
        input: 'gmaps:ChIJtest',
        notes: notes ?? undefined,
      });

      await waitForState(submitted.jobId, 'completed');
      expect(await client.places.list()).toMatchObject([{userNote: expected}]);
    }
  }, 60000);

  it('rolls back a new place if a tag was deleted before the worker runs', async () => {
    await expect(
      importPlace(db, google, 'ChIJtest', [{tagId: randomUUID()}]),
    ).rejects.toThrow();
    expect(await client.places.list()).toEqual([]);
  });

  it('retries transient metadata failures and eventually creates the place', async () => {
    google.getMetadata.mockRejectedValueOnce(new Error('temporary failure'));
    const submitted = await client.places.import({input: 'gmaps:ChIJtest'});

    await waitForState(submitted.jobId, 'completed');
    expect(google.getMetadata).toHaveBeenCalledTimes(2);
    expect(await client.places.list()).toHaveLength(1);
  }, 20000);

  it('leaves no partial place after permanent metadata failure', async () => {
    google.getMetadata.mockRejectedValue(new Error('provider unavailable'));
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
      const importOutput = await cli(
        'import',
        'gmaps:ChIJtest',
        '--tag',
        tag.name,
        '--tag',
        tag.id,
        '--tag-note',
        tag.name,
        'Order the Espresso',
        '--notes',
        'Try the espresso tonic',
      );
      const submitted = JSON.parse(importOutput.stdout);

      await waitForState(submitted.jobId, 'completed');
      const statusOutput = await cli('import-status', submitted.jobId);
      expect(JSON.parse(statusOutput.stdout).state).toBe('completed');
      const listOutput = await cli('list');
      expect(JSON.parse(listOutput.stdout)).toHaveLength(1);
      const notesOutput = await cli('list');
      expect(JSON.parse(notesOutput.stdout)[0].userNote).toBe('Try the espresso tonic');
      expect(await db.select().from(placeTags)).toMatchObject([
        {tagId: tag.id, note: 'Order the Espresso'},
      ]);
      const [saved] = await client.places.list();
      const tagOutput = await cli('tag', saved!.id, tag.name, '--notes', 'Updated note');
      expect(JSON.parse(tagOutput.stdout)).toMatchObject({
        tagId: tag.id,
        note: 'Updated note',
      });
      const untagOutput = await cli('untag', saved!.id, tag.id);
      expect(JSON.parse(untagOutput.stdout)).toMatchObject({
        removed: true,
      });
      expect(await db.select().from(placeTags)).toEqual([]);
      await expect(cli('import', 'https://evil.test')).rejects.toMatchObject({code: 1});
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  }, 20000);
});
