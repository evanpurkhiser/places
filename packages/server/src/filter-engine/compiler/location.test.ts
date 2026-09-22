import type {SQL} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {expect, expectTypeOf, it} from 'vitest';

import {createDatabase} from '../../db/index.ts';
import {createContext} from '../context.ts';
import {placeFilterEngine} from '../index.ts';

import {locationCompiler} from './location.ts';

const db = createDatabase('postgres://localhost/unused');

it('returns a SQL predicate', () => {
  expectTypeOf(locationCompiler.compile).returns.toEqualTypeOf<SQL>();
});

async function compile(query: string) {
  const context = createContext(db);
  const resolved = await placeFilterEngine.resolve(
    placeFilterEngine.prepare(query),
    context,
  );

  return new PgDialect().sqlToQuery(placeFilterEngine.compile(resolved));
}

it('treats a full opening as a range plus its buffer', async () => {
  const result = await compile(
    'location[sector(point(0, 0), bearing:0deg, spread:360deg, range:1km, buffer:200m)]',
  );

  expect(result.params).toEqual([0, 0, 1_000, 200]);
  expect(result.sql).not.toContain('ST_MakePolygon');
});

it('compiles rectangle bounds as parameterized degree comparisons', async () => {
  const result = await compile(
    'location[rect(point(-74.03, 40.76), point(-73.95, 40.70))]',
  );

  expect(result.params).toEqual([40.7, 40.76, -74.03, -73.95]);
  expect(result.sql).toContain('ST_Y("places"."coordinates"::geometry) between');
  expect(result.sql).toContain('ST_X("places"."coordinates"::geometry) between');
});

it('compiles antimeridian crossings as either longitude interval', async () => {
  const result = await compile('location[rect(point(170, 10), point(-170, -10))]');

  expect(result.params).toEqual([-10, 10, 170, -170]);
  expect(result.sql).toContain('>= $3 or ST_X("places"."coordinates"::geometry) <= $4');
});

it.each([
  ['800m', 800],
  ['1.5km', 1500],
  ['100ft', 30.48],
  ['.5mi', 804.672],
])('compiles radius with %s to parameterized geography SQL', async (distance, meters) => {
  const result = await compile(`location[radius(point(-73.985, 40.726), ${distance})]`);

  expect(result.sql).toContain(
    'ST_DWithin("places"."coordinates", ST_SetSRID(ST_MakePoint(',
  );
  expect(result.sql).toContain('4326)::geography');
  expect(result.params).toEqual([-73.985, 40.726, meters]);
});
