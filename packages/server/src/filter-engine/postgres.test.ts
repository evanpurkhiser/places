import {inArray} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Pool} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {createDatabase} from '../db/index.ts';
import {places} from '../db/schema.ts';

import {placeFilterEngine} from './index.ts';

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('filter engine with PostgreSQL', () => {
  const databaseName = `places_filter_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');

  url.pathname = `/${databaseName}`;

  const db = createDatabase(url.href);

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    await db.insert(places).values([
      {
        googlePlaceId: 'a',
        name: 'Cafe',
        formattedAddress: 'NYC',
        coordinates: 'SRID=4326;POINT(-74 40)',
        userNote: '100%_good',
      },
      {
        googlePlaceId: 'b',
        name: 'Bar',
        formattedAddress: 'NYC',
        coordinates: 'SRID=4326;POINT(-74 40)',
        userNote: '',
      },
      {
        googlePlaceId: 'c',
        name: 'Empty',
        formattedAddress: 'NYC',
        coordinates: 'SRID=4326;POINT(-74 40)',
        userNote: null,
      },
    ]);
  }, 30000);

  afterAll(async () => {
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  async function names(query: string) {
    const prepared = placeFilterEngine.prepare(query);
    const resolved = await placeFilterEngine.resolve(prepared, null);
    const predicate = placeFilterEngine.compile(resolved, null);
    const rows = await db
      .select({name: places.name})
      .from(places)
      .where(predicate)
      .orderBy(places.name);

    return rows.map(row => row.name);
  }

  it('treats absent or empty notes as false and negation as their complement', async () => {
    expect(await names('notes[*]')).toEqual(['Cafe']);
    expect(await names('notes[""]')).toEqual(['Cafe']);
    expect(await names('notes[=""]')).toEqual([]);
    expect(await names('!notes[*]')).toEqual(['Bar', 'Empty']);
    expect(await names('!notes[=missing]')).toEqual(['Bar', 'Cafe', 'Empty']);
  });

  it('keeps SQL wildcards literal and scopes notes to the place', async () => {
    expect(await names('notes["%_good"]')).toEqual(['Cafe']);
    expect(await names('notes[outlet]')).toEqual([]);
  });
  it('distinguishes literal pattern characters from wildcard matches in PostgreSQL', async () => {
    const fixtures = [
      ['Literal', 'a%_good'],
      ['Near', 'abgood'],
      ['Star', 'a*tail'],
      ['Expanded', 'axxtail'],
      ['Backslash', String.raw`a\tail`],
      ['Quote', "x' OR 1=1 --"],
    ];
    const inserted = await db
      .insert(places)
      .values(
        fixtures.map(([name, note]) => ({
          googlePlaceId: randomUUID(),
          name: name!,
          userNote: note,
          formattedAddress: 'NYC',
          coordinates: 'SRID=4326;POINT(-74 40)',
        })),
      )
      .returning({id: places.id});

    try {
      expect(await names('notes["%_good"]')).toEqual(['Cafe', 'Literal']);
      expect(await names(String.raw`notes["a\*t*"]`)).toEqual(['Star']);
      expect(await names('notes[="a*tail"]')).toEqual(['Star']);
      expect(await names(String.raw`notes["a\\tail"]`)).toEqual(['Backslash']);
      expect(await names(`notes["x' OR 1=1 --"]`)).toEqual(['Quote']);
    } finally {
      await db.delete(places).where(
        inArray(
          places.id,
          inserted.map(row => row.id),
        ),
      );
    }
  });
});
