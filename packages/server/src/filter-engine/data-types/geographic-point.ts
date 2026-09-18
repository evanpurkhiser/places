import {InvalidValueError, valueType} from '@places/common/filter-engine';

import type {Context, Point} from '../context.ts';

export const geographicPoint = valueType<Point, Context, string>({
  name: 'geographic point',
  description:
    'A place name, address, Google Maps place link, gmaps:<place_id>, or explicit point(longitude, latitude). Include a city or region in place names to guide the search.',
  decode: literal => {
    const name = literal.value.trim();

    if (!name || name.length > 4096) {
      throw new InvalidValueError('Expected a place name of 1–4096 characters.');
    }

    return name;
  },
  resolve: (value, context) =>
    typeof value === 'string' ? context.resolvePoint(value) : value,
});
