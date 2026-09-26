import type {Place} from './rpc.ts';

export function googleMapsUrl(place: Pick<Place, 'googlePlaceId' | 'name'>) {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', place.name);
  url.searchParams.set('query_place_id', place.googlePlaceId);

  return url.href;
}
