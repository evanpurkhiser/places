export interface Bounds {
  west: number;
  north: number;
  east: number;
  south: number;
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

export function placesQuery(bounds: Bounds, search: string, tag: string) {
  const {west, north, east, south} = normalizeBounds(bounds);
  // The query grammar accepts decimal coordinates, including near-zero bounds.
  const rectangle = `location[rect(point(${west.toFixed(8)}, ${north.toFixed(8)}), point(${east.toFixed(8)}, ${south.toFixed(8)}))]`;
  const filter = search.trim();

  return [rectangle, filter ? `(${filter})` : '', tag ? `tag[=${quote(tag)}]` : '']
    .filter(Boolean)
    .join(' ');
}

export function appendTagFilter(search: string, tag: string) {
  const filter = `tag[=${quote(tag)}]`;
  const current = search.trim();

  return current ? `(${current}) ${filter}` : filter;
}
