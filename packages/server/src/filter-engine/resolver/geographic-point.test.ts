import {SearchError} from '@places/common/search';
import {PgDialect} from 'drizzle-orm/pg-core';
import {describe, expect, expectTypeOf, it, vi} from 'vitest';

import {createDatabase} from '../../db/index.ts';
import {GoogleUnavailableError} from '../../services/google/errors.ts';
import {createGooglePlaces} from '../../services/google/index.ts';
import {createContext, type Point} from '../context.ts';
import {placeFilterEngine} from '../index.ts';

const dialect = new PgDialect();
const db = createDatabase('postgres://localhost/unused');
const eastVillage = {
  id: 'east',
  displayName: {text: 'East Village'},
  formattedAddress: 'New York, NY',
  googleMapsUri: 'https://maps.google.com/?q=East+Village',
  location: {longitude: -73.985, latitude: 40.726},
};
const brooklyn = {
  ...eastVillage,
  id: 'brooklyn',
  displayName: {text: 'Brooklyn'},
  location: {longitude: -73.95, latitude: 40.65},
};

function setup() {
  const google = {...createGooglePlaces(), search: vi.fn(), get: vi.fn()};
  const context = createContext(db, google);
  const compile = async (query: string) => {
    const resolved = await placeFilterEngine.resolve(
      placeFilterEngine.prepare(query),
      context,
    );
    return dialect.sqlToQuery(placeFilterEngine.compile(resolved));
  };
  return {google, context, compile};
}

describe('named geographic points', () => {
  it.each(['AND', 'OR'])(
    'resolves %s branches concurrently and preserves parameter order',
    async operator => {
      const {google, compile} = setup();
      const first = Promise.withResolvers<Array<typeof eastVillage>>();
      const second = Promise.withResolvers<Array<typeof eastVillage>>();
      google.search
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      const result = compile(
        `location[radius("East Village", 1mi)] ${operator} location[radius("Brooklyn", 2mi)]`,
      );

      await vi.waitFor(() =>
        expect(google.search.mock.calls).toEqual([['East Village'], ['Brooklyn']]),
      );
      second.resolve([brooklyn]);
      first.resolve([eastVillage]);
      const compiled = await result;

      expect(compiled.params).toEqual([
        -73.985, 40.726, 1609.344, -73.95, 40.65, 3218.688,
      ]);
    },
  );

  it('shares pending lookups within a query context', async () => {
    const {google, compile} = setup();
    const pending = Promise.withResolvers<Array<typeof eastVillage>>();
    google.search.mockReturnValue(pending.promise);
    const result = compile(
      'location[radius(" East Village ", 1mi)] location[radius("East Village", 2mi)]',
    );

    await vi.waitFor(() => expect(google.search).toHaveBeenCalledTimes(1));
    pending.resolve([eastVillage]);
    const compiled = await result;

    expect(compiled.params).toEqual([
      -73.985, 40.726, 1609.344, -73.985, 40.726, 3218.688,
    ]);
    await createContext(db, google).resolvePoint('East Village');
    expect(google.search).toHaveBeenCalledTimes(2);
  });

  it('resolves origin and towards names concurrently', async () => {
    const {google, context} = setup();
    const pending = Promise.withResolvers<Array<typeof eastVillage>>();
    google.search.mockReturnValue(pending.promise);
    const resolution = placeFilterEngine.resolve(
      placeFilterEngine.prepare(
        'location[sector("Union Square", towards:"East Village")]',
      ),
      context,
    );

    await vi.waitFor(() =>
      expect(google.search.mock.calls).toEqual([['Union Square'], ['East Village']]),
    );
    pending.resolve([eastVillage]);
    await expect(resolution).rejects.toThrow('must differ');
  });

  it('resolves names used by rectangle arguments', async () => {
    const {google, compile} = setup();
    google.search.mockResolvedValueOnce([eastVillage]).mockResolvedValueOnce([brooklyn]);
    const result = await compile('location[rect("East Village", "Brooklyn")]');

    expect(result.params).toEqual([40.65, 40.726, -73.985, -73.95]);
  });

  it('uses exact place IDs without a text search', async () => {
    const {google, context, compile} = setup();
    google.get.mockResolvedValue(eastVillage);
    expectTypeOf(context.resolvePoint).returns.toEqualTypeOf<Promise<Point>>();
    const result = await compile('location[radius("gmaps:east", 800m)]');

    expect(result.params).toEqual([-73.985, 40.726, 800]);
    expect(google.get).toHaveBeenCalledExactlyOnceWith('east');
    expect(google.search).not.toHaveBeenCalled();
  });

  it('leaves explicit points independent of Google configuration', async () => {
    const {google, compile} = setup();
    const result = await compile('location[radius(point(0, 0), 1m)]');

    expect(result.params).toEqual([0, 0, 1]);
    expect(google.search).not.toHaveBeenCalled();
    expect(google.get).not.toHaveBeenCalled();
  });

  it('reports missing places at the literal source', async () => {
    const {google, compile} = setup();
    google.search.mockResolvedValue([]);
    await expect(compile('location[radius("missing", 1mi)]')).rejects.toMatchObject({
      diagnostics: [
        {
          code: 'invalid_value',
          message: 'No place found for "missing".',
          location: {start: {offset: 16}, end: {offset: 25}},
        },
      ],
    });
  });

  it('uses the first result when several places match', async () => {
    const {google, compile} = setup();
    google.search.mockResolvedValue([eastVillage, brooklyn]);
    const result = await compile('location[radius("New York", 1mi)]');

    expect(result.params).toEqual([-73.985, 40.726, 1609.344]);
  });

  it('resolves Maps links through the same ID resolver as imports', async () => {
    const {google, compile} = setup();
    const resolve = vi.spyOn(google, 'resolve');
    google.get.mockResolvedValue(eastVillage);
    const url =
      'https://www.google.com/maps/search/?api=1&query=East+Village&query_place_id=east';
    const result = await compile(`location[radius("${url}", 1mi)]`);

    expect(result.params).toEqual([-73.985, 40.726, 1609.344]);
    expect(resolve).toHaveBeenCalledExactlyOnceWith(url);
    expect(google.get).toHaveBeenCalledExactlyOnceWith('east');
    expect(google.search).not.toHaveBeenCalled();
  });

  it.each(['" "', '"gmaps:bad/id"'])('rejects invalid names and IDs: %s', async input => {
    const {google, compile} = setup();
    await expect(compile(`location[radius(${input}, 1mi)]`)).rejects.toBeInstanceOf(
      SearchError,
    );
    expect(google.search).not.toHaveBeenCalled();
    expect(google.get).not.toHaveBeenCalled();
  });

  it('validates the entire query before making requests', async () => {
    const {google, compile} = setup();
    await expect(
      compile('location[radius("East Village", 1mi)] location[radius("Brooklyn", -1mi)]'),
    ).rejects.toBeInstanceOf(SearchError);
    expect(google.search).not.toHaveBeenCalled();
  });

  it('preserves service failures instead of reporting invalid query syntax', async () => {
    const {google, compile} = setup();
    const error = new GoogleUnavailableError('Google Places search failed. Try again.');
    google.search.mockRejectedValue(error);
    await expect(compile('location[radius("East Village", 1mi)]')).rejects.toBe(error);
  });
});
