import {expect, it} from 'vitest';

import {defineFilterEngine, implementFilterEngine} from '../index.ts';
import {duration} from '../values/duration.ts';
import {time} from '../values/time.ts';

import {open} from './open.ts';

const definition = defineFilterEngine({
  values: {time, duration},
  filters: {open},
  functions: {},
});
const engine = implementFilterEngine(definition, {
  valueResolvers: {
    time: {
      resolveReference: () => ({kind: 'instant', epochMilliseconds: 0}),
    },
  },
  filters: {open: {compile: () => true}},
  boolean: {
    all: () => true,
    and: values => values.every(Boolean),
    or: values => values.some(Boolean),
    not: value => !value,
  },
});

it('rejects competing interval endpoints', () => {
  expect(() => engine.prepare('open[@now, for:2h, until:@now]')).toThrow(
    'either for or until',
  );
});

it('requires exactly one start selector', () => {
  expect(() => engine.prepare('open[]')).toThrow('exactly one of time or in');
  expect(() => engine.prepare('open[@now, in:30m]')).toThrow('exactly one of time or in');
});

it('accepts every documented argument shape', () => {
  for (const example of open.examples) {
    expect(() => engine.prepare(example.query)).not.toThrow();
  }
});
