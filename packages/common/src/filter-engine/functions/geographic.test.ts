import {expect, it} from 'vitest';

import {location} from '../filters/location.ts';
import {defineFilterEngine, implementFilterEngine, InvalidValueError} from '../index.ts';
import {degrees} from '../values/degrees.ts';
import {distance} from '../values/distance.ts';
import {geographicPoint} from '../values/geographic-point.ts';
import {geographicPredicate} from '../values/geographic-predicate.ts';
import {latitude} from '../values/latitude.ts';
import {longitude} from '../values/longitude.ts';

import {point} from './point.ts';
import {radius} from './radius.ts';
import {rect} from './rect.ts';
import {sector} from './sector.ts';

const definition = defineFilterEngine({
  values: {
    degrees,
    distance,
    geographicPoint,
    geographicPredicate,
    latitude,
    longitude,
  },
  filters: {location},
  functions: {point, radius, rect, sector},
});
const engine = implementFilterEngine(definition, {
  valueResolvers: {
    geographicPoint: {
      resolve: value => {
        if (typeof value === 'string') {
          throw new InvalidValueError('Named points are unavailable in this test');
        }

        return value;
      },
    },
  },
  filters: {location: {compile: ({condition}) => condition.value}},
  boolean: {
    all: () => null,
    and: values => values[0] ?? null,
    or: values => values[0] ?? null,
    not: value => value,
  },
});

function evaluate(value: string) {
  return Promise.resolve().then(() =>
    engine.execute(engine.prepare(`location[${value}]`), null),
  );
}

it.each([
  'point(181, 0), point(0, 0)',
  'point(0, 0), point(0, -91)',
  'point(0, 0)',
  'point(0, -10), point(1, 10)',
])('rejects invalid rectangle arguments: %s', async args => {
  await expect(evaluate(`rect(${args})`)).rejects.toThrow();
});

it.each([
  'point(181, 0), 1m',
  'point(0, -91), 1m',
  'point(NaN, 0), 1m',
  'point("", 0), 1m',
  'point(0x10, 0), 1m',
  'point(0, 0), 0m',
  'point(0, 0), -1m',
  'point(0, 0), 1',
  'point(0, 0), 1yd',
  'point(0, 0), NaNkm',
])('rejects invalid radius arguments: %s', async args => {
  await expect(evaluate(`radius(${args})`)).rejects.toThrow();
});

it.each([
  ['point(0, 0)', 'exactly one'],
  ['point(0, 0), towards:point(1, 1), bearing:90deg', 'exactly one'],
  ['point(0, 0), bearing:90deg', 'requires range'],
  ['point(0, 0), towards:point(180, 0)', 'within 90 degrees'],
  ['point(0, 0), bearing:90, range:1km', 'unit deg'],
  ['point(0, 0), bearing:-1deg, range:1km', 'bearing must'],
  ['point(0, 0), bearing:360deg, range:1km', 'bearing must'],
  ['point(0, 0), bearing:90deg, spread:0deg, range:1km', 'spread must'],
  ['point(0, 0), bearing:90deg, spread:361deg, range:1km', 'spread must'],
  ['point(0, 0), bearing:90deg, range:10000km', 'range must'],
  ['point(0, 0), towards:point(0, 0)', 'must differ'],
  ['point(180, 0), towards:point(-180, 0)', 'must differ'],
  ['point(0, 90), towards:point(90, 90)', 'must differ'],
])('rejects invalid sector arguments: %s', async (args, message) => {
  await expect(evaluate(`sector(${args})`)).rejects.toThrow(message);
});

it.each([
  'rect(point(-180, 90), point(180, -90))',
  'rect(point(0, 0), point(0, 0))',
  'radius(point(-180, 90), 1km)',
  'radius(point(180, -90), 1m)',
])('accepts geographic boundary case %s', async value => {
  await expect(evaluate(value)).resolves.toBeDefined();
});
