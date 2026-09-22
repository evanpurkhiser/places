import {defineValue, InvalidValueError} from '../definitions.ts';

export interface Point {
  longitude: number;
  latitude: number;
}

export const geographicPoint = defineValue<Point, string>()({
  name: 'geographic point',
  description:
    'A place name, address, Google Maps place link, gmaps:<place_id>, or explicit point(longitude, latitude). Include a city or region in place names to guide the search.',
  literals: true,
  references: false,
  decode: literal => {
    const name = literal.value.trim();

    if (!name || name.length > 4096) {
      throw new InvalidValueError('Expected a place name of 1–4096 characters.');
    }

    return name;
  },
});
