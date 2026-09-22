import {z} from 'zod';

import {defineValue, InvalidValueError} from '../definitions.ts';

export type Time =
  | {kind: 'instant'; epochMilliseconds: number}
  | {kind: 'clock'; minuteOfDay: number}
  | {kind: 'weekly'; minuteOfWeek: number};

const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const localTimePattern =
  /^(?:(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)\s+)?(\d{1,2})(?::([0-5]\d))?(?: ?([ap]m))?$/i;
const timestamp = z.iso.datetime({offset: true});

function decodeTime(input: string): Time {
  const value = input.trim();
  const match = localTimePattern.exec(value);

  if (match) {
    const hour = Number(match[2]);
    const meridiem = match[4]?.toLowerCase();
    const validHour = meridiem ? hour >= 1 && hour <= 12 : hour <= 23;

    if (validHour && (meridiem || match[3] !== undefined)) {
      const localHour = meridiem ? (hour % 12) + (meridiem === 'pm' ? 12 : 0) : hour;
      const minuteOfDay = localHour * 60 + Number(match[3] ?? 0);

      if (!match[1]) {
        return {kind: 'clock', minuteOfDay};
      }

      const day = weekdays.indexOf(match[1].slice(0, 3).toLowerCase());
      return {kind: 'weekly', minuteOfWeek: day * 1440 + minuteOfDay};
    }
  }

  if (timestamp.safeParse(value).success) {
    const epochMilliseconds = Date.parse(value);

    if (Number.isFinite(epochMilliseconds)) {
      return {kind: 'instant', epochMilliseconds};
    }
  }

  throw new InvalidValueError(
    'Expected a time such as "6pm", "22:00", "mon 6pm", or an ISO timestamp with Z or a UTC offset. Use @now for the current instant.',
  );
}

export const time = defineValue<Time>()({
  name: 'time',
  description:
    'A local clock time ("6pm", "6:45", "22:00"), a weekly local time ("mon 6pm", "Monday 18:00"), an ISO timestamp with Z or a UTC offset ("2026-09-21T18:00:00-04:00"), or @now. Clock times mean today in each place’s time zone. Weekdays accept full names or three-letter abbreviations, ignoring case. Times without am/pm use a 24-hour clock and require minutes. @now is captured once per query; instants use Unix milliseconds.',
  literals: true,
  references: true,
  decode: literal => decodeTime(literal.value),
});
