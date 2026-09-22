import {InvalidValueError, type FilterCompilerFor} from '@places/common/filter-engine';
import type {open as openDefinition} from '@places/common/filter-engine/filters/open';
import type {Time} from '@places/common/filter-engine/values/time';
import {sql, type SQL} from 'drizzle-orm';

import {places} from '../../db/schema.ts';
import type {Context} from '../context.ts';

const week = 10080;
const maxElapsed = 31 * 24 * 60 * 60 * 1000;

function minuteOfWeek(local: SQL): SQL {
  return sql`(extract(dow from ${local})::integer * 1440 + extract(hour from ${local})::integer * 60 + extract(minute from ${local})::integer)`;
}

function weeklyCoverage(start: number, length?: number): SQL {
  if (length === undefined) {
    return sql`${places.hoursWeeklyOpen} @> ${start}::integer`;
  }

  if (length >= week) {
    return sql`${places.hoursWeeklyOpen} @> '{[0,10080)}'::int4multirange`;
  }

  const end = Math.ceil(start + length);
  const ranges =
    end <= week
      ? [[start, end]]
      : [
          [start, week],
          [0, end - week],
        ];
  const serialized = `{${ranges.map(([a, b]) => `[${a},${b})`).join(',')}}`;

  return sql`${places.hoursWeeklyOpen} @> ${serialized}::int4multirange`;
}

type DatedTime = Exclude<Time, {kind: 'weekly'}>;

function instant(value: DatedTime, now: number, zone: SQL): SQL {
  if (value.kind === 'instant') {
    return sql`${new Date(value.epochMilliseconds).toISOString()}::timestamptz`;
  }

  const today = sql`(${new Date(now).toISOString()}::timestamptz at time zone ${zone})::date`;

  // PostgreSQL selects the standard-time offset for repeated local times.
  return sql`((${today} + ${value.minuteOfDay} * interval '1 minute') at time zone ${zone})`;
}

function clockExists(value: Time | undefined, resolved: SQL | undefined): SQL {
  if (value?.kind !== 'clock' || !resolved) {
    return sql`true`;
  }

  const local = sql`(${resolved} at time zone ${places.timeZone})`;

  // A skipped wall-clock time normalizes to a different local time in PostgreSQL.
  return sql`(extract(hour from ${local}) * 60 + extract(minute from ${local})) = ${value.minuteOfDay}`;
}

function offset(value: SQL, zone: SQL): SQL {
  return sql`(((${value}) at time zone ${zone}) - ((${value}) at time zone 'UTC'))`;
}

function requestedMinutes(start: SQL, end: SQL, zone: SQL): SQL {
  // Check both ends of every constant-offset minute segment. This covers partial
  // minutes without requiring the unrequested portion of an opening interval.
  // Historical offsets can change within a UTC minute; split those minutes at
  // second boundaries, matching the precision of IANA transition timestamps.
  const lo = sql`lo`;
  const hi = sql`hi - interval '1 microsecond'`;
  const sameOffset = sql`${offset(lo, zone)} = ${offset(hi, zone)}`;
  const minute = minuteOfWeek(sql`(value at time zone ${zone})`);

  return sql`(
    with request as (
      select ${start} as starts, ${end} as ends
    ), minutes as (
      select greatest(tick, starts) as lo,
             least(tick + interval '1 minute', ends) as hi
      from request
      cross join lateral generate_series(
        date_trunc('minute', starts, 'UTC'),
        ends - interval '1 microsecond', interval '1 minute'
      ) as minute_ticks(tick)
    )
    select range_agg(int4range(${minute}, ${minute} + 1, '[)'))
      from minutes
      cross join lateral (
        select lo as a, hi as b where ${sameOffset}
        union all
        select greatest(tick, lo), least(tick + interval '1 second', hi)
        from generate_series(0, 59) as second_ticks(second)
        cross join lateral (
          select date_trunc('second', lo, 'UTC') + second * interval '1 second' as tick
        ) as ticks
        where tick < hi and not (${sameOffset})
      ) as segments
      cross join lateral (values (a), (b - interval '1 microsecond')) as samples(value)
  )`;
}

function instantBounds(
  start: DatedTime,
  until: DatedTime | undefined,
  elapsed: number | undefined,
  now: number,
  zone: SQL,
): {from: SQL; to?: SQL} {
  const from = instant(start, now, zone);

  if (until) {
    return {from, to: instant(until, now, zone)};
  }

  return {
    from,
    to:
      elapsed === undefined
        ? undefined
        : sql`(${from} + ${elapsed} * interval '1 millisecond')`,
  };
}

function datedCoverage(
  start: DatedTime,
  until: DatedTime | undefined,
  elapsed: number | undefined,
  now: number,
): SQL {
  const {from, to} = instantBounds(start, until, elapsed, now, sql`${places.timeZone}`);
  const predicate = (() => {
    if (!to) {
      return sql`${places.hoursWeeklyOpen} @> ${minuteOfWeek(sql`(${from} at time zone ${places.timeZone})`)}`;
    }

    const zone = sql`zone`;
    const bounds = instantBounds(start, until, elapsed, now, zone);
    const minutes = requestedMinutes(bounds.from, bounds.to!, zone);

    // This uncorrelated scalar subquery becomes an InitPlan: project the interval
    // once per zone, then reuse its canonical multirange for every matching place.
    const requirements = sql`(select jsonb_object_agg(zone, (${minutes})::text)
      from (select distinct ${places.timeZone} as zone from ${places}
            where ${places.timeZone} is not null) as time_zones)`;

    return sql`${places.hoursWeeklyOpen} @> ((${requirements} ->> ${places.timeZone})::int4multirange)`;
  })();

  return sql`case
    when ${places.timeZone} is null then null
    when not (${clockExists(start, from)} and ${clockExists(until, to)}) then null
    else ${predicate}
  end`;
}

function coverage(
  start: Time,
  until: Time | undefined,
  elapsed: number | undefined,
  now: number,
): SQL {
  if (until && until.kind !== start.kind) {
    throw new InvalidValueError(
      'open requires start and until to be the same kind of time: clock, weekly, or instant.',
    );
  }

  if (start.kind === 'weekly') {
    const end = until?.kind === 'weekly' ? until.minuteOfWeek : undefined;

    if (end === start.minuteOfWeek) {
      throw new InvalidValueError(
        'open requires distinct weekly endpoints. Use for:168h for a full week.',
      );
    }

    const length =
      end === undefined
        ? elapsed === undefined
          ? undefined
          : elapsed / 60_000
        : (end - start.minuteOfWeek + week) % week;

    return weeklyCoverage(start.minuteOfWeek, length);
  }

  const difference =
    until?.kind === 'instant' && start.kind === 'instant'
      ? until.epochMilliseconds - start.epochMilliseconds
      : until?.kind === 'clock' && start.kind === 'clock'
        ? (until.minuteOfDay - start.minuteOfDay) * 60_000
        : undefined;

  if (difference !== undefined && difference <= 0) {
    throw new InvalidValueError(
      'open requires until to be later than the start. Use weekday endpoints or for for overnight clock times.',
    );
  }

  if ((difference ?? elapsed ?? 0) > maxElapsed) {
    throw new InvalidValueError('open supports dated intervals up to 31 days (744h).');
  }

  return datedCoverage(start, until?.kind === 'weekly' ? undefined : until, elapsed, now);
}

export const openCompiler = {
  compile: ({time, until, for: duration}, context: Context) => {
    const predicate = coverage(time.value, until?.value, duration?.value, context.now);

    // Keep containment visible to the planner so weekly queries can use GiST.
    // DISTINCT FROM makes an absent business status neutral; missing hours still
    // propagate NULL through the containment predicate and boolean composition.
    return sql`(
        ${places.businessStatus} is distinct from 'CLOSED_TEMPORARILY'
        and ${places.businessStatus} is distinct from 'CLOSED_PERMANENTLY'
        and (${predicate})
      )`;
  },
} satisfies FilterCompilerFor<typeof openDefinition, SQL, Context>;
