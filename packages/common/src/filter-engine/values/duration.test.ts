import {expect, it} from 'vitest';

import type {StringValue} from '../../search/types.ts';

import {duration} from './duration.ts';

function literal(value: string): StringValue {
  const position = {offset: 0, line: 1, column: 1};
  return {
    type: 'string',
    value,
    quoted: false,
    wildcards: [],
    text: value,
    location: {start: position, end: position},
  };
}

it.each([
  ['30m', 1_800_000],
  ['2h', 7_200_000],
  ['1.5h', 5_400_000],
  ['1.1h', 3_960_000],
  ['2.3h', 8_280_000],
  ['0.07m', 4_200],
  ['.0000025h', 9],
  ['.5m', 30_000],
])('decodes duration %s into elapsed milliseconds', (input, milliseconds) => {
  expect(duration.decode?.(literal(input))).toBe(milliseconds);
});

it.each([
  '0h',
  '-2h',
  '2',
  '2d',
  'Infinityh',
  '1e3h',
  '2hours',
  '1h30m',
  '0.0000001m',
  '1.00000000000000001h',
  '999999999999999999h',
])('rejects invalid duration %s', input => {
  expect(() => duration.decode?.(literal(input))).toThrow('Expected a positive duration');
});
