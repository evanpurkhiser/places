import {describe, expect, it} from 'vitest';

import {normalizeHours, openingHours} from './hours.ts';

const point = (day: number, hour: number, minute = 0) => ({day, hour, minute});
const period = (day: number, start: number, end: number) => ({
  open: point(day, start),
  close: point(day, end),
});

describe('weekly hours normalization', () => {
  it('distinguishes missing, empty, and all-week schedules', () => {
    expect(normalizeHours()).toBeNull();
    expect(normalizeHours({})).toBeNull();
    expect(normalizeHours({periods: []})).toEqual([]);
    expect(normalizeHours({periods: [{open: point(0, 0)}]})).toEqual([[0, 10080]]);
  });

  it('sorts split shifts and merges overlapping or adjacent periods', () => {
    expect(
      normalizeHours({
        periods: [
          period(1, 13, 17),
          period(1, 10, 12),
          period(1, 9, 11),
          period(1, 17, 18),
        ],
      }),
    ).toEqual([
      [1980, 2160],
      [2220, 2520],
    ]);
  });

  it('preserves multi-day hours, week wrap, midnight closes, and minute precision', () => {
    expect(normalizeHours({periods: [{open: point(5, 9), close: point(0, 23)}]})).toEqual(
      [
        [0, 1380],
        [7740, 10080],
      ],
    );
    expect(normalizeHours({periods: [{open: point(6, 13), close: point(0, 1)}]})).toEqual(
      [
        [0, 60],
        [9420, 10080],
      ],
    );
    expect(
      normalizeHours({periods: [{open: point(6, 22, 15), close: point(0, 0)}]}),
    ).toEqual([[9975, 10080]]);
  });

  it('rejects ambiguous or invalid endpoints instead of inventing hours', () => {
    expect(() => normalizeHours({periods: [{open: point(1, 0)}]})).toThrow();
    expect(() => normalizeHours({periods: [period(1, 9, 9)]})).toThrow();
    expect(openingHours.safeParse({periods: [period(7, 9, 10)]}).success).toBe(false);
    expect(openingHours.safeParse({periods: [period(1, 9, 24)]}).success).toBe(false);
  });
});
