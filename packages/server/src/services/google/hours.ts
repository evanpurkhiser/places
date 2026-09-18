import {z} from 'zod';

export type WeeklyHours = Array<[number, number]>;

const point = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});
const period = z.object({open: point, close: point.optional()});
export const openingHours = z.object({periods: z.array(period).optional()});

const week = 7 * 24 * 60;
const minute = (value: z.infer<typeof point>) =>
  value.day * 1440 + value.hour * 60 + value.minute;

export function normalizeHours(hours?: z.infer<typeof openingHours>): WeeklyHours | null {
  if (hours?.periods === undefined) {
    return null;
  }

  const periods = hours.periods;

  if (periods.length === 1 && !periods[0]!.close && minute(periods[0]!.open) === 0) {
    return [[0, week]];
  }

  const ranges = periods
    .flatMap(({open, close}): WeeklyHours => {
      if (!close) {
        throw new Error('Missing closing endpoint in weekly hours.');
      }

      const start = minute(open);
      const end = minute(close);

      if (start === end) {
        throw new Error('Identical endpoints in weekly hours.');
      }

      return end > start
        ? [[start, end]]
        : [[start, week], ...(end ? [[0, end] as [number, number]] : [])];
    })
    .sort(([a], [b]) => a - b);

  return ranges.reduce<WeeklyHours>((merged, [start, end]) => {
    const previous = merged.at(-1);

    if (previous && start <= previous[1]) {
      return [...merged.slice(0, -1), [previous[0], Math.max(previous[1], end)]];
    }

    return [...merged, [start, end]];
  }, []);
}
