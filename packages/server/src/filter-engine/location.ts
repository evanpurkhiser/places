import {
  defineFilter,
  defineFunction,
  InvalidValueError,
  valueType,
} from '@places/common/filter-engine';
import {sql, type SQL} from 'drizzle-orm';

import {places} from '../db/schema.ts';

import {distance} from './values.ts';

const coordinate = (name: string, limit: number) =>
  valueType({
    name,
    description: `Decimal degrees between -${limit} and ${limit}, inclusive.`,
    decode: value => {
      const number = Number(value.value);

      if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.value) ||
        !Number.isFinite(number) ||
        Math.abs(number) > limit
      ) {
        throw new InvalidValueError(
          `Invalid ${name}: expected a number between -${limit} and ${limit}`,
        );
      }

      return number;
    },
  });

const longitude = coordinate('longitude', 180);
const latitude = coordinate('latitude', 90);
const geographicPoint = valueType<{longitude: number; latitude: number}>({
  name: 'geographic point',
  description: 'An explicit point(longitude, latitude).',
});
const geographicPredicate = valueType<SQL>({
  name: 'geographic predicate',
  description: 'A geographic condition produced by radius.',
});

export const point = defineFunction({
  name: 'point',
  description: 'A geographic point in longitude, latitude order (WGS84).',
  positional: [
    {name: 'longitude', description: 'Longitude in degrees.', type: longitude},
    {name: 'latitude', description: 'Latitude in degrees.', type: latitude},
  ],
  returns: geographicPoint,
  resolve: ({positional: [lng, lat]}) => ({longitude: lng.value, latitude: lat.value}),
});

export const radius = defineFunction({
  name: 'radius',
  description: 'Match places at most the given geographic distance from a point.',
  positional: [
    {name: 'origin', description: 'Center point.', type: geographicPoint},
    {name: 'distance', description: 'Maximum distance from the center.', type: distance},
  ],
  returns: geographicPredicate,
  resolve: ({positional: [origin, distance]}) =>
    sql`ST_DWithin(${places.coordinates}, ST_SetSRID(ST_MakePoint(${origin.value.longitude}, ${origin.value.latitude}), 4326)::geography, ${distance.value})`,
});

export const location = defineFilter({
  name: 'location',
  description: 'Match places using a geographic condition.',
  examples: [
    {
      query: 'location[radius(point(-73.985, 40.726), 800m)]',
      description: 'Places within 800 meters of the given point.',
    },
  ],
  positional: [
    {name: 'condition', description: 'Geographic condition.', type: geographicPredicate},
  ],
  compile: ({positional: [condition]}) => condition.value,
});

export const locationTypes = [longitude, latitude, geographicPoint, geographicPredicate];
