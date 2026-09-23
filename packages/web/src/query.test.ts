import {parseQuery} from '@places/common/search';
import {describe, expect, it} from 'vitest';

import {placeFilterEngine} from '../../server/src/filter-engine/index.ts';

import {appendTagFilter, normalizeBounds, placesQuery} from './query.ts';

const bounds = {west: -74.03, north: 40.76, east: -73.95, south: 40.7};

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

  it('serializes near-zero viewport coordinates without exponent notation', () => {
    const query = placesQuery(
      {west: 1e-7, east: 2e-7, north: 3e-7, south: -3e-7},
      '',
      '',
    );
    expect(() => placeFilterEngine.prepare(query)).not.toThrow();
  });
});
