import {PgDialect} from 'drizzle-orm/pg-core';
import {expect, it, vi} from 'vitest';

import {createDatabase} from '../db/index.ts';
import {createGooglePlaces} from '../services/google/index.ts';

import {createContext} from './context.ts';
import {placeFilterEngine} from './index.ts';

const db = createDatabase('postgres://localhost/unused');

async function compile(query: string) {
  const context = createContext(db);
  const resolved = await placeFilterEngine.resolve(
    placeFilterEngine.prepare(query),
    context,
  );

  return new PgDialect().sqlToQuery(placeFilterEngine.compile(resolved, context));
}

it.each([
  ['point(0, 0)', 'exactly one'],
  ['point(0, 0), towards:point(1, 1), bearing:90deg', 'exactly one'],
  ['point(0, 0), bearing:90deg', 'requires range'],
  ['point(0, 0), towards:point(180, 0)', 'within 90 degrees'],
  ['point(0, 0), bearing:90, range:1km', 'unit deg'],
  ['point(0, 0), bearing:-1deg, range:1km', 'bearing must'],
  ['point(0, 0), bearing:360deg, range:1km', 'bearing must'],
  ['point(0, 0), bearing:90deg, spread:0deg, range:1km', 'spread must'],
  ['point(0, 0), bearing:90deg, spread:361deg, range:1km', 'spread must'],
  ['point(0, 0), bearing:90deg, range:10000km', 'range must'],
  ['point(0, 0), towards:point(0, 0)', 'must differ'],
  ['point(180, 0), towards:point(-180, 0)', 'must differ'],
  ['point(0, 90), towards:point(90, 90)', 'must differ'],
])('rejects invalid sector arguments: %s', async (args, message) => {
  await expect(compile(`location[sector(${args})]`)).rejects.toThrow(message);
});

it('treats a full opening as a range plus its buffer', async () => {
  const result = await compile(
    'location[sector(point(0, 0), bearing:0deg, spread:360deg, range:1km, buffer:200m)]',
  );

  expect(result.params).toEqual([0, 0, 1_000, 200]);
  expect(result.sql).not.toContain('ST_MakePolygon');
});

it('resolves origin and towards names concurrently', async () => {
  const pending =
    Promise.withResolvers<
      Awaited<ReturnType<ReturnType<typeof createGooglePlaces>['search']>>
    >();
  const google = {
    ...createGooglePlaces(),
    search: vi.fn().mockReturnValue(pending.promise),
  };
  const context = createContext(db, google);
  const resolution = placeFilterEngine.resolve(
    placeFilterEngine.prepare('location[sector("Union Square", towards:"East Village")]'),
    context,
  );

  await vi.waitFor(() =>
    expect(google.search.mock.calls).toEqual([['Union Square'], ['East Village']]),
  );
  pending.resolve([
    {
      id: 'test',
      displayName: {text: 'Test'},
      formattedAddress: '',
      googleMapsUri: '',
      location: {longitude: 0, latitude: 0},
    },
  ]);
  await expect(resolution).rejects.toThrow('must differ');
});
