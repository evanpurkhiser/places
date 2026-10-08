import {parseQuery} from '@places/common/search';
import {describe, expect, it} from 'vitest';

import {placeFilterEngine} from '../../server/src/filter-engine/index.ts';

import {
  appendTagFilter,
  normalizeBounds,
  parseSearch,
  placesQuery,
  withUserLocation,
} from './query.ts';

const bounds = {west: -74.03, north: 40.76, east: -73.95, south: 40.7};

describe('live search parsing', () => {
  it.each(['', '   '])('accepts an empty search: %j', search => {
    expect(parseSearch(search)).toEqual({query: null, error: null});
  });

  it.each(['name[', 'name[coffee] OR', '(tag[cafe]', 'name["coffee'])(
    'returns local diagnostics for incomplete input: %s',
    search => {
      expect(parseSearch(search).error?.diagnostics[0]?.code).toBe('syntax');
    },
  );

  it('returns the AST when an incomplete search is completed', () => {
    expect(parseSearch('name[coffee').error).not.toBeNull();
    expect(parseSearch('name[coffee]')).toMatchObject({
      query: {type: 'filter', key: 'name'},
      error: null,
    });
  });
});

it('adds an exact tag to every branch of an existing search', () => {
  const query = appendTagFilter('name[coffee] OR notes[espresso]', 'star.*');

  expect(() => placeFilterEngine.prepare(query)).not.toThrow();
  expect(parseQuery(query)).toMatchObject({
    type: 'and',
    children: [
      {type: 'group', expression: {type: 'or'}},
      {
        type: 'filter',
        key: 'tag',
        arguments: [{operator: '=', value: {value: 'star.*', wildcards: []}}],
      },
    ],
  });
});

it('escapes tag names when starting a search', () => {
  const query = appendTagFilter(' ', 'a"b\\c]');

  expect(parseQuery(query)).toMatchObject({
    type: 'filter',
    key: 'tag',
    arguments: [{operator: '=', value: {value: 'a"b\\c]'}}],
  });
});

describe('viewport queries', () => {
  it.each([
    [
      {west: 170, east: 190, north: 10, south: -10},
      {west: 170, east: -170, north: 10, south: -10},
    ],
    [
      {west: -190, east: -170, north: 10, south: -10},
      {west: 170, east: -170, north: 10, south: -10},
    ],
    [
      {west: -200, east: 200, north: 100, south: -100},
      {west: -180, east: 180, north: 90, south: -90},
    ],
  ])('normalizes wrapped and full-world map bounds', (input, expected) => {
    expect(normalizeBounds(input)).toEqual(expected);
  });

  it('keeps every OR branch within map bounds and the selected tag', () => {
    const filter = 'name[coffee] OR notes[espresso]';
    const query = placesQuery(bounds, filter, 'star.*');

    expect(query).toContain(`(${filter})`);
    expect(() => placeFilterEngine.prepare(query)).not.toThrow();
    expect(parseQuery(query)).toMatchObject({
      type: 'and',
      children: [
        {type: 'filter', key: 'location'},
        {
          type: 'group',
          expression: {
            type: 'or',
            children: [
              {type: 'filter', key: 'name'},
              {type: 'filter', key: 'notes'},
            ],
          },
        },
        {
          type: 'filter',
          key: 'tag',
          arguments: [{operator: '=', value: {value: 'star.*', wildcards: []}}],
        },
      ],
    });
  });

  it.each([
    'tag[type.cafe] !has[notes]',
    'name["La Cabra"]',
    'name[cof*]',
    'location[radius(point(-74, 40.7), 1km)]',
  ])('passes filter expressions through: %s', filter => {
    const query = placesQuery(bounds, filter, '');
    expect(query).toContain(`(${filter})`);
    expect(() => placeFilterEngine.prepare(query)).not.toThrow();
  });

  it('preserves invalid input for query diagnostics', () => {
    expect(() => placeFilterEngine.prepare(placesQuery(bounds, 'name[', ''))).toThrow();
  });

  it('omits empty search and tag filters', () => {
    expect(placesQuery(bounds, '   ', '')).toMatch(
      /^location\[rect\(point\(.+\), point\(.+\)\)\]$/,
    );
  });

  it('omits map bounds when searching all places', () => {
    expect(placesQuery(null, 'name[coffee]', '')).toBe('(name[coffee])');
  });

  it('serializes near-zero viewport coordinates without exponent notation', () => {
    const query = placesQuery(
      {west: 1e-7, east: 2e-7, north: 3e-7, south: -3e-7},
      '',
      '',
    );
    expect(() => placeFilterEngine.prepare(query)).not.toThrow();
  });
});

describe('user location ordering', () => {
  it('uses the first user location as the reference and switches to distance', () => {
    expect(
      withUserLocation({sort: 'name'}, {longitude: -73.985, latitude: 40.726}),
    ).toEqual({
      sort: 'distance',
      referenceLocation: 'point(-73.985, 40.726)',
    });
  });

  it('updates the reference without overriding a later sort selection', () => {
    expect(
      withUserLocation(
        {sort: 'recently-saved', referenceLocation: 'point(-73.985, 40.726)'},
        {longitude: -73.98, latitude: 40.72},
      ),
    ).toEqual({
      sort: 'recently-saved',
      referenceLocation: 'point(-73.98, 40.72)',
    });
  });
});
