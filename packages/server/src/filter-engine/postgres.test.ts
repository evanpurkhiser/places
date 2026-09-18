import {eq, inArray} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Pool} from 'pg';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {createDatabase} from '../db/index.ts';
import {places, placeTags, tags} from '../db/schema.ts';

import {compilePlaceQuery} from './index.ts';

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
    const saved = await db
      .insert(places)
      .values([
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
      ])
      .returning();
    const assigned = await db
      .insert(tags)
      .values([{name: 'type:cafe'}, {name: 'attr:laptop-friendly'}])
      .returning();

    await db.insert(placeTags).values([
      {placeId: saved[0]!.id, tagId: assigned[0]!.id, note: 'upstairs'},
      {placeId: saved[0]!.id, tagId: assigned[1]!.id, note: 'outlets'},
      {placeId: saved[1]!.id, tagId: assigned[0]!.id, note: 'outlets'},
    ]);
  }, 30000);

  afterAll(async () => {
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  async function names(query: string) {
    const predicate = await compilePlaceQuery(query, {db});
    const rows = await db
      .select({name: places.name})
      .from(places)
      .where(predicate)
      .orderBy(places.name);

    return rows.map(row => row.name);
  }

  it('matches whole-place tag negation and avoids duplicate results', async () => {
    expect(await names('tag[type:*] OR tag[attr:*]')).toEqual(['Bar', 'Cafe']);
    expect(await names('!tag[type:cafe]')).toEqual(['Empty']);
    expect(await names('!tag[=type:cafe]')).toEqual(['Empty']);
  });

  it('measures radius in meters across the antimeridian and supports negation', async () => {
    const inserted = await db
      .insert(places)
      .values([
        {
          googlePlaceId: 'radius-near',
          name: 'RadiusNear',
          formattedAddress: '',
          coordinates: 'SRID=4326;POINT(-179.999 0)',
        },
        {
          googlePlaceId: 'radius-far',
          name: 'RadiusFar',
          formattedAddress: '',
          coordinates: 'SRID=4326;POINT(-179.98 0)',
        },
      ])
      .returning({id: places.id});

    try {
      expect(await names('location[radius(point(179.999, 0), 300m)]')).toEqual([
        'RadiusNear',
      ]);
      expect(
        await names('name[Radius*] !location[radius(point(179.999, 0), 300m)]'),
      ).toEqual(['RadiusFar']);
      expect(await names('location[radius(point(-74, 40), 1ft)]')).toEqual([
        'Bar',
        'Cafe',
        'Empty',
      ]);
    } finally {
      await db.delete(places).where(
        inArray(
          places.id,
          inserted.map(row => row.id),
        ),
      );
    }
  });

  it('correlates tag assignment notes', async () => {
    expect(await names('tag[type:cafe, notes:outlet]')).toEqual(['Bar']);
    expect(await names('!tag[type:cafe, notes:outlet]')).toEqual(['Cafe', 'Empty']);
  });

  it('treats absent or empty notes as false and negation as their complement', async () => {
    expect(await names('notes[*]')).toEqual(['Cafe']);
    expect(await names('notes[""]')).toEqual(['Cafe']);
    expect(await names('notes[=""]')).toEqual([]);
    expect(await names('!notes[*]')).toEqual(['Bar', 'Empty']);
    expect(await names('!has[notes]')).toEqual(['Bar', 'Empty']);
    expect(await names('!notes[=missing]')).toEqual(['Bar', 'Cafe', 'Empty']);
  });

  it('keeps SQL wildcards literal and scopes notes to the place', async () => {
    expect(await names('notes["%_good"]')).toEqual(['Cafe']);
    expect(await names('notes[outlet]')).toEqual([]);
    expect(await names('!has[tag]')).toEqual(['Empty']);
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

  it('validates exact tags across every boolean branch before selecting places', async () => {
    await expect(names('name[*] OR !tag[missing]')).rejects.toThrow(
      'Unknown tag: missing',
    );
    expect(await names('tag[missing:*]')).toEqual([]);
  });
  it('combines membership and note exclusion when assignment notes are absent', async () => {
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: randomUUID(),
        name: 'NoNote',
        formattedAddress: 'NYC',
        coordinates: 'SRID=4326;POINT(-74 40)',
      })
      .returning();
    const [tag] = await db.select().from(tags).where(eq(tags.name, 'type:cafe'));

    try {
      await db.insert(placeTags).values({placeId: place!.id, tagId: tag!.id});
      expect(await names('tag[type:cafe] AND !tag[type:cafe, notes:=outlets]')).toEqual([
        'Cafe',
        'NoNote',
      ]);
      expect(await names('!tag[type:cafe, notes:=outlets]')).toEqual([
        'Cafe',
        'Empty',
        'NoNote',
      ]);
    } finally {
      await db.delete(places).where(eq(places.id, place!.id));
    }
  });
});
