import {expect, it} from 'vitest';

import {googleMapsUrl} from './google-maps.ts';

it('builds a Google Maps URL for a place', () => {
  const url = new URL(googleMapsUrl({name: 'Café & Bar', googlePlaceId: 'place-id'}));

  expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    api: '1',
    query: 'Café & Bar',
    query_place_id: 'place-id',
  });
});
