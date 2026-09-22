import type {FilterCompilerFor} from '@places/common/filter-engine';
import type {location as locationDefinition} from '@places/common/filter-engine/filters/location';
import type {GeographicPredicate} from '@places/common/filter-engine/values/geographic-predicate';
import {sql, type SQL} from 'drizzle-orm';

import {places} from '../../db/schema.ts';
import type {Context} from '../context.ts';

function point({longitude, latitude}: {longitude: number; latitude: number}): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography`;
}

function createSector(center: SQL, heading: SQL, range: SQL, spread: number): SQL {
  return sql`(
    select ST_MakePolygon(ST_MakeLine(
      ARRAY[center::geometry] || ARRAY(
        select ST_Project(center, range, heading - radians(${spread}) / 2 + radians(${spread}) * step / steps)::geometry
        from generate_series(0, steps) as arc(step)
        order by step
      ) || ARRAY[center::geometry]
    ))::geography
    from (
      select *, greatest(1, ceil(radians(${spread}) / least(radians(1), 2 * acos(greatest(-1, 1 - 0.5 / range)))))::integer as steps
      from (select ${center} as center, ${heading} as heading, ${range} as range) as parameters
    ) as sector
  )`;
}

function compileGeographicPredicate(predicate: GeographicPredicate): SQL {
  if (predicate.kind === 'radius') {
    return sql`ST_DWithin(${places.coordinates}, ${point(predicate.origin)}, ${predicate.distance})`;
  }

  if (predicate.kind === 'rect') {
    const {longitude: west, latitude: north} = predicate.topLeft;
    const {longitude: east, latitude: south} = predicate.bottomRight;
    const longitude = sql`ST_X(${places.coordinates}::geometry)`;
    const latitude = sql`ST_Y(${places.coordinates}::geometry)`;
    const longitudeRange =
      west > east
        ? sql`(${longitude} >= ${west} or ${longitude} <= ${east})`
        : sql`${longitude} between ${west} and ${east}`;

    return sql`(${latitude} between ${south} and ${north} and ${longitudeRange})`;
  }

  const center = point(predicate.origin);
  const {range, heading} = (() => {
    if ('towards' in predicate) {
      const target = point(predicate.towards);
      return {
        range:
          predicate.range === undefined
            ? sql`ST_Distance(${center}, ${target})`
            : sql`${predicate.range}::double precision`,
        heading: sql`ST_Azimuth(${center}, ${target})`,
      };
    }

    return {
      range: sql`${predicate.range}::double precision`,
      heading: sql`radians(${predicate.bearing})`,
    };
  })();

  if (predicate.spread === 360) {
    return sql`ST_DWithin(${places.coordinates}, ${center}, ${range} + ${predicate.buffer})`;
  }

  const sector = createSector(center, heading, range, predicate.spread);

  return sql`ST_DWithin(${places.coordinates}, ${sector}, ${predicate.buffer})`;
}

export const locationCompiler = {
  compile: ({condition}) => compileGeographicPredicate(condition.value),
} satisfies FilterCompilerFor<typeof locationDefinition, SQL, Context>;
