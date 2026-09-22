import {expect, it} from 'vitest';

import type {StringValue} from '../../search/types.ts';

import {time} from './time.ts';

function literal(value: string): StringValue {
  const position = {offset: 0, line: 1, column: 1};
  return {
    type: 'string',
    value,
    quoted: true,
    wildcards: [],
    text: value,
    location: {start: position, end: position},
  };
}

it.each([
  ['mon 6pm', {kind: 'weekly', minuteOfWeek: 2520}],
  ['Monday 18:00', {kind: 'weekly', minuteOfWeek: 2520}],
  ['MONDAY 6:30PM', {kind: 'weekly', minuteOfWeek: 2550}],
  ['MONDAY 6:30 PM', {kind: 'weekly', minuteOfWeek: 2550}],
  ['mon 6 pm', {kind: 'weekly', minuteOfWeek: 2520}],
  ['MON 6PM', {kind: 'weekly', minuteOfWeek: 2520}],
  ['sun 12am', {kind: 'weekly', minuteOfWeek: 0}],
  ['Sunday 12pm', {kind: 'weekly', minuteOfWeek: 720}],
  ['sat 23:59', {kind: 'weekly', minuteOfWeek: 10079}],
  ['tuesday 02:00', {kind: 'weekly', minuteOfWeek: 3000}],
  ['Wednesday 00:00', {kind: 'weekly', minuteOfWeek: 4320}],
  ['Thursday 00:00', {kind: 'weekly', minuteOfWeek: 5760}],
  ['Friday 00:00', {kind: 'weekly', minuteOfWeek: 7200}],
  ['6PM', {kind: 'clock', minuteOfDay: 1080}],
  ['6 pm', {kind: 'clock', minuteOfDay: 1080}],
  ['12 am', {kind: 'clock', minuteOfDay: 0}],
  ['6:45', {kind: 'clock', minuteOfDay: 405}],
  ['22:00', {kind: 'clock', minuteOfDay: 1320}],
  ['12am', {kind: 'clock', minuteOfDay: 0}],
  ['12PM', {kind: 'clock', minuteOfDay: 720}],
] as const)('decodes time %s', (input, expected) => {
  expect(time.decode?.(literal(input))).toEqual(expected);
});

it('decodes equivalent offset timestamps to the same instant', () => {
  expect(time.decode?.(literal('2026-09-21T18:00:00-04:00'))).toEqual(
    time.decode?.(literal('2026-09-21T22:00:00Z')),
  );
});

it.each([
  'now',
  '6 p.m.',
  '6p.m.',
  '6  pm',
  '12a.m.',
  'MON 6 p.m.',
  '6',
  '24:00',
  '6:75',
  '0pm',
  'mon 6',
  'mon 24:00',
  'mon 0am',
  'mon 13pm',
  'mon 6:60pm',
  'tomorrow 6pm',
  'next Monday 6pm',
  'mondayish 6pm',
  '2026-09-21T18:00:00',
  '2026-02-29T18:00:00Z',
  '2026-04-31T18:00:00Z',
  '2026-09-21T18:00:00+25:00',
])('rejects invalid or ambiguous time %s', input => {
  expect(() => time.decode?.(literal(input))).toThrow('Expected a time');
});
