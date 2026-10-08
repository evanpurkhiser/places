import type {PlaceSort} from '@places/common/contract/place';
import type {Point} from '@places/common/filter-engine/values/geographic-point';
import {parseQuery, SearchError} from '@places/common/search';

export function parseSearch(search: string) {
  try {
    return {query: parseQuery(search), error: null};
  } catch (error) {
    if (error instanceof SearchError) {
      return {query: null, error};
    }

    throw error;
  }
}

export interface Bounds {
  west: number;
  north: number;
  east: number;
  south: number;
}

export interface PlacesOrdering {
  sort: PlaceSort;
  referenceLocation?: string;
}

export function withUserLocation(
  current: PlacesOrdering,
  {longitude, latitude}: Point,
): PlacesOrdering {
  return {
    sort: current.referenceLocation ? current.sort : 'distance',
    referenceLocation: `point(${longitude}, ${latitude})`,
  };
}

function wrapLongitude(value: number) {
  return ((((value + 180) % 360) + 360) % 360) - 180;
}

export function normalizeBounds(bounds: Bounds): Bounds {
  const fullWorld = bounds.east - bounds.west >= 360;

  return {
    west: fullWorld ? -180 : wrapLongitude(bounds.west),
    east: fullWorld ? 180 : wrapLongitude(bounds.east),
    north: Math.min(90, Math.max(-90, bounds.north)),
    south: Math.min(90, Math.max(-90, bounds.south)),
  };
}

function quote(value: string) {
  return `"${value.replaceAll(/[\r\n]/g, ' ').replaceAll(/[\\"*]/g, '\\$&')}"`;
}

export function placesQuery(bounds: Bounds | null, search: string, tag: string) {
  const rectangle = bounds ? boundsFilter(bounds) : '';
  const filter = search.trim();

  return [rectangle, filter ? `(${filter})` : '', tag ? `tag[=${quote(tag)}]` : '']
    .filter(Boolean)
    .join(' ');
}

function boundsFilter(bounds: Bounds) {
  const {west, north, east, south} = normalizeBounds(bounds);

  // The query grammar accepts decimal coordinates, including near-zero bounds.
  return `location[rect(point(${west.toFixed(8)}, ${north.toFixed(8)}), point(${east.toFixed(8)}, ${south.toFixed(8)}))]`;
}

export function appendTagFilter(search: string, tag: string) {
  const filter = `tag[=${quote(tag)}]`;
  const current = search.trim();

  return current ? `(${current}) ${filter}` : filter;
}
