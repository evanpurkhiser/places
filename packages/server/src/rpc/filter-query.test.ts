import {serve} from '@hono/node-server';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {createApp} from '../app.ts';
import {configSchema} from '../config.ts';
import {createDatabase} from '../db/index.ts';
import {places, placeTags, tags} from '../db/schema.ts';
import {createGooglePlaces} from '../services/google/index.ts';

const exec = promisify(execFile);
const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('place filtering through API and CLI', () => {
  const databaseName = `places_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');
  url.pathname = `/${databaseName}`;
  const db = createDatabase(url.href);
  const app = createApp({
    db,
    config: configSchema.parse({database: {url: url.href}}),
    jobs: new PgBoss(url.href),
    google: createGooglePlaces(),
  });
  const client: Client = createORPCClient(
    new RPCLink({
      url: 'http://localhost/rpc',
      fetch: request => Promise.resolve(app.fetch(request)),
    }),
  );
  const cafeId = randomUUID();
  const bakeryId = randomUUID();

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    await db.insert(places).values([
      {
        id: cafeId,
        googlePlaceId: 'cafe',
        name: 'Cafe',
        formattedAddress: 'New York',
        coordinates: 'SRID=4326;POINT(-74 40)',
        userNote: 'Great coffee',
      },
      {
        id: bakeryId,
        googlePlaceId: 'bakery',
        name: 'Bakery',
        formattedAddress: 'New York',
        coordinates: 'SRID=4326;POINT(-74 40)',
      },
    ]);
    const [tag] = await db.insert(tags).values({name: 'type:cafe'}).returning();
    await db
      .insert(placeTags)
      .values({placeId: cafeId, tagId: tag!.id, note: 'Outlets upstairs'});
  }, 30000);

  afterAll(async () => {
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('preserves unfiltered list calls and the existing place response', async () => {
    const result = await client.places.list();
    expect(result).toHaveLength(2);
    expect(await client.places.list({query: ''})).toEqual(result);
    expect(result.find(place => place.id === cafeId)).toMatchObject({
      coordinates: {latitude: 40, longitude: -74},
      userNote: 'Great coffee',
    });
  });

  it('combines tag assignment notes, boolean groups, and missing data', async () => {
    const result = await client.places.list({
      query: '(tag[type:cafe, notes:outlets] AND notes[coffee]) OR !has[notes]',
    });
    expect(result.map(place => place.id).sort()).toEqual([cafeId, bakeryId].sort());
    const nonCafes = await client.places.list({query: '!tag[type:cafe]'});
    expect(nonCafes.map(place => place.id)).toEqual([bakeryId]);
  });

  it.each([
    'tag[',
    'location[radius(@home, 1mi)]',
    'location[within("Manhattan, NYC")]',
    'tag[custom()]',
    'tag[missing]',
  ])('returns structured diagnostics for %s', async query => {
    await expect(client.places.list({query})).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      data: {
        diagnostics: [
          expect.objectContaining({
            code: expect.any(String),
            message: expect.any(String),
            location: {
              start: expect.objectContaining({offset: expect.any(Number)}),
              end: expect.objectContaining({offset: expect.any(Number)}),
            },
          }),
        ],
      },
    });
  });

  it('prints filtered JSON and structured query errors through the CLI', async () => {
    const server = serve({fetch: app.fetch, hostname: '127.0.0.1', port: 15190});

    try {
      if (!server.listening) {
        await once(server, 'listening');
      }

      const cli = (...args: string[]) =>
        exec(process.execPath, [
          fileURLToPath(new URL('../../../cli/src/main.ts', import.meta.url)),
          '--server',
          'http://127.0.0.1:15190',
          ...args,
        ]);
      const {stdout} = await cli('list', '--query', 'tag[type:cafe]');
      expect(JSON.parse(stdout).map((place: {id: string}) => place.id)).toEqual([cafeId]);
      const {stdout: documentation} = await cli('docs', 'filter');
      expect(documentation).toMatch(/^Filter language\n/);
      expect(documentation).toContain('Example: tag[favorite]');
      expect(documentation).not.toMatch(/^"/);

      try {
        await cli('list', '--query', 'tag[');
        throw new Error('Expected CLI failure');
      } catch (error) {
        expect(error).toMatchObject({code: 1, stdout: ''});
        const {stderr} = error as {stderr: string};
        expect(JSON.parse(stderr)).toMatchObject({
          diagnostics: [{code: 'syntax', location: expect.any(Object)}],
        });
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  });
});
