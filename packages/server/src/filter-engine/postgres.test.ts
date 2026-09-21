import {eq, inArray, sql} from 'drizzle-orm';
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
      .values([{name: 'cafe'}, {name: 'laptop-friendly'}])
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
    expect(await names('tag[cafe*] OR tag[laptop-*]')).toEqual(['Bar', 'Cafe']);
    expect(await names('!tag[cafe]')).toEqual(['Empty']);
    expect(await names('!tag[=cafe]')).toEqual(['Empty']);
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

  it('buffers every sector edge, crosses the antimeridian, and handles north wrap', async () => {
    const fixtures = [
      ['SectorOrigin', 0, 0],
      ['SectorBehind', 199, 270],
      ['SectorTooFarBehind', 201, 270],
      ['SectorAhead', 900, 90],
      ['SectorCap', 1199, 90],
      ['SectorPastCap', 1201, 90],
      ['SectorSide', 1000, 110],
      ['SectorOutside', 1000, 130],
      ['SectorNorthWest', 900, 355],
      ['SectorNorthEast', 900, 5],
    ] as const;
    const inserted = await db
      .insert(places)
      .values(
        fixtures.map(([name, distance, bearing]) => ({
          googlePlaceId: randomUUID(),
          name,
          formattedAddress: '',
          coordinates: sql`ST_Project(ST_SetSRID(ST_MakePoint(179.999, 0), 4326)::geography, ${distance}::double precision, radians(${bearing}))`,
        })),
      )
      .returning({id: places.id});
    const sector = 'location[sector(point(179.999, 0), bearing:90deg, range:1km)]';

    try {
      const [endpoint] = await db
        .select({
          longitude: sql<number>`ST_X(${places.coordinates}::geometry)`,
          latitude: sql<number>`ST_Y(${places.coordinates}::geometry)`,
        })
        .from(places)
        .where(eq(places.name, 'SectorAhead'));
      const towards = `towards:point(${endpoint!.longitude}, ${endpoint!.latitude})`;
      expect(await names(`location[sector(point(179.999, 0), ${towards})]`)).toEqual([
        'SectorAhead',
        'SectorBehind',
        'SectorOrigin',
        'SectorSide',
      ]);
      expect(
        await names(`location[sector(point(179.999, 0), ${towards}, range:1km)]`),
      ).toEqual(await names(sector));
      expect(
        await names(`location[sector(point(179.999, 0), ${towards}, spread:360deg)]`),
      ).toEqual(
        fixtures
          .map(([name]) => name)
          .filter(name => !['SectorCap', 'SectorPastCap'].includes(name))
          .sort(),
      );
      expect(await names(sector)).toEqual([
        'SectorAhead',
        'SectorBehind',
        'SectorCap',
        'SectorOrigin',
        'SectorSide',
      ]);
      expect(await names(`name[Sector*] !${sector}`)).toEqual([
        'SectorNorthEast',
        'SectorNorthWest',
        'SectorOutside',
        'SectorPastCap',
        'SectorTooFarBehind',
      ]);
      expect(
        await names(
          'location[sector(point(179.999, 0), bearing:0deg, range:1km, buffer:1m)]',
        ),
      ).toEqual(['SectorNorthEast', 'SectorNorthWest', 'SectorOrigin']);
      expect(
        await names(
          'location[sector(point(179.999, 0), towards:point(-179, 0), range:1km)]',
        ),
      ).toEqual(await names(sector));
      expect(
        await names(
          'location[sector(point(179.999, 0), bearing:90deg, spread:270deg, range:1km, buffer:1m)]',
        ),
      ).toEqual([
        'SectorAhead',
        'SectorNorthEast',
        'SectorNorthWest',
        'SectorOrigin',
        'SectorOutside',
        'SectorSide',
      ]);
      expect(
        await names(
          'location[sector(point(179.999, 0), bearing:90deg, spread:360deg, range:1km)]',
        ),
      ).toEqual(
        fixtures
          .map(([name]) => name)
          .filter(name => name !== 'SectorPastCap')
          .sort(),
      );
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
    expect(await names('tag[cafe, notes:outlet]')).toEqual(['Bar']);
    expect(await names('!tag[cafe, notes:outlet]')).toEqual(['Cafe', 'Empty']);
  });

  it('matches rectangle interiors and edges, wrapped bounds, and degenerate bounds', async () => {
    const fixtures = [
      ['RectCenter', 0, 0],
      ['RectNorthwest', -10, 10],
      ['RectSoutheast', 10, -10],
      ['RectNorth', 0, 10],
      ['RectSouth', 0, -10],
      ['RectWest', -10, 0],
      ['RectEast', 10, 0],
      ['RectOutside', 10.001, 0],
      ['RectAbove', 0, 10.001],
      ['RectWrappedEast', 175, 0],
      ['RectWrappedWest', -175, 0],
    ] as const;
    const inserted = await db
      .insert(places)
      .values(
        fixtures.map(([name, lng, lat]) => ({
          googlePlaceId: randomUUID(),
          name,
          formattedAddress: '',
          coordinates: `SRID=4326;POINT(${lng} ${lat})`,
        })),
      )
      .returning({id: places.id});
    const rectangle = 'location[rect(point(-10, 10), point(10, -10))]';

    try {
      expect(await names(rectangle)).toEqual([
        'RectCenter',
        'RectEast',
        'RectNorth',
        'RectNorthwest',
        'RectSouth',
        'RectSoutheast',
        'RectWest',
      ]);
      expect(await names(`name[Rect*] !${rectangle}`)).toEqual([
        'RectAbove',
        'RectOutside',
        'RectWrappedEast',
        'RectWrappedWest',
      ]);
      expect(await names('location[rect(point(170, 10), point(-170, -10))]')).toEqual([
        'RectWrappedEast',
        'RectWrappedWest',
      ]);
      expect(await names('location[rect(point(0, 0), point(0, 0))]')).toEqual([
        'RectCenter',
      ]);
      expect(await names('location[rect(point(0, 10), point(0, -10))]')).toEqual([
        'RectCenter',
        'RectNorth',
        'RectSouth',
      ]);
      expect(
        await names('name[Rect*] location[rect(point(-180, 90), point(180, -90))]'),
      ).toEqual(fixtures.map(([name]) => name).sort());
      expect(
        await names('name[Rect*] location[rect(point(-170, 90), point(170, -90))]'),
      ).toEqual(
        fixtures
          .map(([name]) => name)
          .filter(name => !name.startsWith('RectWrapped'))
          .sort(),
      );
    } finally {
      await db.delete(places).where(
        inArray(
          places.id,
          inserted.map(row => row.id),
        ),
      );
    }
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
    expect(await names('tag[missing.*]')).toEqual([]);
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
    const [tag] = await db.select().from(tags).where(eq(tags.name, 'cafe'));

    try {
      await db.insert(placeTags).values({placeId: place!.id, tagId: tag!.id});
      expect(await names('tag[cafe] AND !tag[cafe, notes:=outlets]')).toEqual([
        'Cafe',
        'NoNote',
      ]);
      expect(await names('!tag[cafe, notes:=outlets]')).toEqual([
        'Cafe',
        'Empty',
        'NoNote',
      ]);
    } finally {
      await db.delete(places).where(eq(places.id, place!.id));
    }
  });
});
