import {createFilterEngine, defineFilter} from '@places/common/filter-engine';
import {afterEach, expect, it, vi} from 'vitest';

import {createDatabase} from '../../db/index.ts';
import {createContext} from '../context.ts';
import {placeFilterEngine} from '../index.ts';

import {duration} from './duration.ts';
import {time} from './time.ts';

// Exercise value binding without implementing availability evaluation.
const probe = defineFilter({
  name: 'probe',
  description: 'Inspect resolved temporal values.',
  parameters: {
    start: {description: 'Start time.', type: time},
    until: {description: 'End time.', type: time, optional: true},
    for: {description: 'Elapsed duration.', type: duration, optional: true},
  },
  compile: ({start, until, for: duration}) =>
    JSON.stringify({
      start: start.value,
      until: until?.value,
      for: duration?.value,
    }),
});
const engine = createFilterEngine({
  types: [time, duration],
  filters: [probe],
  boolean: {
    all: () => '',
    and: values => values.join(),
    or: values => values.join(),
    not: value => value,
  },
});
const db = createDatabase('postgres://localhost/unused');

async function resolve(args: string, context = createContext(db)) {
  const resolved = await engine.resolve(engine.prepare(`probe[${args}]`), context);

  return JSON.parse(engine.compile(resolved, context));
}

afterEach(() => vi.useRealTimers());

it.each([
  ['mon 6pm', 2520],
  ['Monday 18:00', 2520],
  ['MONDAY 6:30PM', 2550],
  ['MONDAY 6:30 PM', 2550],
  ['mon 6 pm', 2520],
  ['MON 6PM', 2520],
  ['sun 12am', 0],
  ['Sunday 12pm', 720],
  ['sat 23:59', 10079],
  ['tuesday 02:00', 3000],
  ['Wednesday 00:00', 4320],
  ['Thursday 00:00', 5760],
  ['Friday 00:00', 7200],
])('decodes weekly local time %s', async (input, minuteOfWeek) => {
  expect(await resolve(JSON.stringify(input))).toEqual({
    start: {kind: 'weekly', minuteOfWeek},
  });
});

it.each([
  ['6PM', 1080],
  ['6pm', 1080],
  ['6 pm', 1080],
  ['6 PM', 1080],
  ['12 am', 0],
  ['6:45', 405],
  ['22:00', 1320],
  ['12am', 0],
  ['12PM', 720],
])('decodes local clock time %s', async (input, minuteOfDay) => {
  expect(await resolve(JSON.stringify(input))).toEqual({
    start: {kind: 'clock', minuteOfDay},
  });
});

it('accepts an unquoted clock time in the first filter argument', async () => {
  expect(await resolve('6:45')).toEqual({start: {kind: 'clock', minuteOfDay: 405}});
});

it('decodes offset timestamps to the same instant as UTC', async () => {
  const result = await resolve(
    '"2026-09-21T18:00:00-04:00", until:"2026-09-21T22:00:00Z"',
  );

  expect(result.start).toEqual({
    kind: 'instant',
    epochMilliseconds: Date.UTC(2026, 8, 21, 22),
  });
  expect(result.until).toEqual(result.start);
});

it('captures now once per query context', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const context = createContext(db);
  vi.setSystemTime(2000);

  expect(await resolve('@now, until:@now', context)).toEqual({
    start: {kind: 'instant', epochMilliseconds: 1000},
    until: {kind: 'instant', epochMilliseconds: 1000},
  });
  const nextQuery = await resolve('@now');
  expect(nextQuery.start.epochMilliseconds).toBe(2000);
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
])('rejects invalid or ambiguous time %s during preparation', input => {
  expect(() => engine.prepare(`probe[${JSON.stringify(input)}]`)).toThrow(
    'Expected a time',
  );
});

it('rejects unknown references', async () => {
  await expect(resolve('@tomorrow')).rejects.toThrow('Unknown time reference');
});

it.each([
  ['30m', 1_800_000],
  ['2h', 7_200_000],
  ['1.5h', 5_400_000],
  ['1.1h', 3_960_000],
  ['2.3h', 8_280_000],
  ['0.07m', 4_200],
  ['.0000025h', 9],
  ['.5m', 30_000],
])('decodes duration %s into elapsed milliseconds', async (input, milliseconds) => {
  const result = await resolve(`@now, for:${input}`);
  expect(result.for).toBe(milliseconds);
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
  expect(() => engine.prepare(`probe[@now, for:${input}]`)).toThrow(
    'Expected a positive duration',
  );
});

it('publishes both types in the Places registry', () => {
  expect(placeFilterEngine.describe().types).toEqual(
    expect.arrayContaining([
      expect.objectContaining({name: 'time', literals: true, references: true}),
      expect.objectContaining({name: 'duration', literals: true, references: false}),
    ]),
  );
});
