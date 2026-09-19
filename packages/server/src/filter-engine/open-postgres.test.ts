import {eq} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Pool} from 'pg';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {createDatabase} from '../db/index.ts';
import {places} from '../db/schema.ts';

import {compilePlaceQuery} from './index.ts';

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('opening hours with PostgreSQL', () => {
  const databaseName = `places_open_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');
  url.pathname = `/${databaseName}`;
  const db = createDatabase(url.href);

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
    const fixtures: Array<{
      name: string;
      hoursWeeklyOpen: Array<[number, number]> | null;
      timeZone?: string | null;
      businessStatus?: string;
    }> = [
      {name: 'always', hoursWeeklyOpen: [[0, 10080]]},
      {name: 'monday', hoursWeeklyOpen: [[2520, 2640]]},
      {name: 'overnight', hoursWeeklyOpen: [[2520, 3000]]},
      {
        name: 'gap',
        hoursWeeklyOpen: [
          [2520, 2580],
          [2610, 2640],
        ],
      },
      {
        name: 'wrap',
        hoursWeeklyOpen: [
          [0, 120],
          [9960, 10080],
        ],
      },
      {
        name: 'spring',
        hoursWeeklyOpen: [
          [60, 120],
          [180, 240],
        ],
      },
      {name: 'fall', hoursWeeklyOpen: [[60, 120]]},
      {name: 'fall-gap', hoursWeeklyOpen: [[75, 105]]},
      {
        name: 'historical',
        hoursWeeklyOpen: [
          [7199, 7200],
          [7244, 7245],
        ],
        timeZone: 'Africa/Monrovia',
      },
      {name: 'empty', hoursWeeklyOpen: []},
      {name: 'unknown', hoursWeeklyOpen: null},
      {name: 'no-zone', hoursWeeklyOpen: [[0, 10080]], timeZone: null},
      {
        name: 'closed',
        hoursWeeklyOpen: [[0, 10080]],
        businessStatus: 'CLOSED_PERMANENTLY',
      },
      {name: 'temporary', hoursWeeklyOpen: null, businessStatus: 'CLOSED_TEMPORARILY'},
      {name: 'utc', hoursWeeklyOpen: [[2520, 2640]], timeZone: 'UTC'},
    ];
    await db.insert(places).values(
      fixtures.map(fixture => ({
        googlePlaceId: fixture.name,
        formattedAddress: '',
        coordinates: 'SRID=4326;POINT(-74 40)',
        timeZone: 'America/New_York',
        ...fixture,
      })),
    );
  }, 30000);

  afterAll(async () => {
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  async function matches(name: string, query: string): Promise<boolean | null> {
    const predicate = await compilePlaceQuery(query, {db});
    const [row] = await db
      .select({match: predicate})
      .from(places)
      .where(eq(places.name, name));

    return row!.match as boolean | null;
  }

  it.each([
    ['monday', 'open["mon 6pm"]', true],
    ['monday', 'open["mon 8pm"]', false],
    ['monday', 'open["mon 6pm", until:"mon 8pm"]', true],
    ['monday', 'open["mon 6pm", for:2h]', true],
    ['gap', 'open["mon 6pm", for:2h]', false],
    ['overnight', 'open["mon 6pm", until:"tue 2am"]', true],
    ['wrap', 'open["sat 10pm", until:"sun 2am"]', true],
    ['wrap', 'open["sat 10pm", for:4h]', true],
    ['always', 'open["sat 10pm", for:200h]', true],
    ['monday', 'open["sat 10pm", for:200h]', false],
    ['empty', 'open["mon 6pm"]', false],
    ['unknown', 'open["mon 6pm"]', null],
    ['unknown', '!open["mon 6pm"]', null],
    ['unknown', 'name[unknown] OR open[@now]', true],
    ['unknown', 'name[other] AND open[@now]', false],
    ['no-zone', 'open["mon 6pm"]', true],
    ['no-zone', 'open[@now]', null],
    ['closed', 'open["mon 6pm"]', false],
    ['temporary', '!open[@now]', true],
    ['monday', 'open["2026-09-21T18:00:00-04:00"]', true],
    ['utc', 'open["2026-09-21T18:00:00-04:00"]', false],
    ['monday', 'open["2026-09-21T18:00:00-04:00", for:2h]', true],
    ['gap', 'open["2026-09-21T18:00:00-04:00", for:2h]', false],
    ['gap', 'open["2026-09-21T18:59:30-04:00", for:0.5m]', true],
    ['gap', 'open["2026-09-21T18:59:30-04:00", for:1m]', false],
    ['wrap', 'open["2026-09-26T22:00:00-04:00", for:4h]', true],
    [
      'spring',
      'open["2026-03-08T01:30:00-05:00", until:"2026-03-08T03:30:00-04:00"]',
      true,
    ],
    ['fall', 'open["2026-11-01T01:30:00-04:00", for:1h]', true],
    ['fall-gap', 'open["2026-11-01T01:30:00-04:00", for:1h]', false],
    ['historical', 'open["1972-01-07T00:44:20Z", until:"1972-01-07T00:44:40Z"]', true],
  ])('%s: %s → %s', async (name, query, expected) => {
    expect(await matches(name, query)).toBe(expected);
  });

  it('evaluates clock times on today’s date in each place’s time zone', async () => {
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-09-22T01:00:00Z'));

    try {
      expect(await matches('monday', 'open[6pm]')).toBe(true);
      expect(await matches('utc', 'open[6pm]')).toBe(false);
      expect(await matches('monday', 'open[6pm, until:8pm]')).toBe(true);
      expect(await matches('monday', 'open[6pm, for:2h]')).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('keeps nonexistent local clock times unknown', async () => {
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-03-08T12:00:00Z'));

    try {
      expect(await matches('spring', 'open[2:30]')).toBeNull();
      expect(await matches('spring', 'open[2:30, until:3am]')).toBeNull();
      expect(await matches('spring', '!open[2:30]')).toBeNull();
      expect(await matches('spring', 'open[1:30, for:1h]')).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });

  it('uses the standard-time occurrence of a repeated local clock time', async () => {
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-11-01T12:00:00Z'));

    try {
      expect(await matches('fall', 'open[1:30, for:0.5h]')).toBe(true);
      expect(await matches('fall', 'open[1:30, for:1h]')).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });
});
