import {defineFunction, InvalidValueError} from '@places/common/filter-engine';
import {sql, type SQL} from 'drizzle-orm';

import {places} from '../../db/schema.ts';
import {degrees} from '../data-types/degrees.ts';
import {distance} from '../data-types/distance.ts';
import {geographicPoint} from '../data-types/geographic-point.ts';
import {geographicPredicate} from '../data-types/geographic-predicate.ts';

function createSector(center: SQL, heading: SQL, range: SQL, spread: number): SQL {
  // Refine one-degree arc steps for a nominal 0.5m chord error.
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

export const sector = defineFunction({
  name: 'sector',
  description:
    'Find places along a heading, within a chosen range and sideways allowance.',
  examples: [
    {
      query: 'location[sector("Union Square, NYC", towards:"East Village, NYC")]',
      description: 'Head towards the East Village, using its distance as the range.',
    },
    {
      query:
        'location[sector("Union Square, NYC", towards:"East Village, NYC", range:2mi)]',
      description: 'Head towards the East Village with a two-mile range.',
    },
    {
      query:
        'location[sector(point(-73.99, 40.735), bearing:90deg, range:1km, spread:60deg, buffer:200m)]',
      description:
        'Search east for one kilometer with a 60-degree opening and 200-meter allowance around the sector.',
    },
  ],
  positional: [{name: 'origin', description: 'Starting point.', type: geographicPoint}],
  named: {
    towards: {
      description: 'Point setting the heading and default forward range.',
      type: geographicPoint,
      optional: true,
    },
    bearing: {
      description: 'Heading clockwise from true north, from 0deg to below 360deg.',
      type: degrees,
      optional: true,
    },
    spread: {
      description: 'Full opening angle, greater than 0deg and at most 360deg.',
      type: degrees,
      optional: true,
    },
    buffer: {
      description: 'Distance to expand the entire sector, including its origin.',
      type: distance,
      optional: true,
    },
    range: {
      description:
        'Forward reach before buffering, less than 10000km. Required with bearing; defaults to the towards distance.',
      type: distance,
      optional: true,
    },
  },
  validate: args => {
    const headings = args.filter(argument =>
      ['towards', 'bearing'].includes(argument.name ?? ''),
    );

    if (headings.length !== 1) {
      return 'sector requires exactly one of towards or bearing';
    }

    if (
      headings[0]!.name === 'bearing' &&
      !args.some(argument => argument.name === 'range')
    ) {
      return 'sector requires range when bearing is specified';
    }
  },
  returns: geographicPredicate,
  resolve: ({positional: [origin], named}) => {
    const spread = named.spread?.value ?? 30;
    const buffer = named.buffer?.value ?? 200;
    const explicitRange = named.range?.value;
    const bearing = named.bearing?.value;
    const towards = named.towards?.value;

    if (bearing !== undefined && (bearing < 0 || bearing >= 360)) {
      throw new InvalidValueError('sector bearing must be from 0deg to below 360deg');
    }

    if (spread <= 0 || spread > 360) {
      throw new InvalidValueError(
        'sector spread must be greater than 0deg and at most 360deg',
      );
    }

    // Keep the sector within a hemisphere so geography has an unambiguous interior.
    if (explicitRange !== undefined && explicitRange >= 10_000_000) {
      throw new InvalidValueError('sector range must be less than 10000km');
    }

    if (
      towards &&
      towards.latitude === origin.value.latitude &&
      (Math.abs(towards.latitude) === 90 ||
        (towards.longitude - origin.value.longitude) % 360 === 0)
    ) {
      throw new InvalidValueError('sector towards must differ from its origin');
    }

    if (towards && explicitRange === undefined) {
      const radians = (degrees: number) => (degrees * Math.PI) / 180;
      const originLatitude = radians(origin.value.latitude);
      const targetLatitude = radians(towards.latitude);
      const longitudeDifference = radians(towards.longitude - origin.value.longitude);
      const dot =
        Math.sin(originLatitude) * Math.sin(targetLatitude) +
        Math.cos(originLatitude) *
          Math.cos(targetLatitude) *
          Math.cos(longitudeDifference);

      if (dot <= 0) {
        throw new InvalidValueError(
          'sector towards must be within 90 degrees of its origin when range is omitted',
        );
      }
    }

    const center = sql`ST_SetSRID(ST_MakePoint(${origin.value.longitude}, ${origin.value.latitude}), 4326)::geography`;

    const target = towards
      ? sql`ST_SetSRID(ST_MakePoint(${towards.longitude}, ${towards.latitude}), 4326)::geography`
      : undefined;
    const range =
      explicitRange !== undefined
        ? sql`${explicitRange}::double precision`
        : sql`ST_Distance(${center}, ${target})`;

    if (spread === 360) {
      return sql`ST_DWithin(${places.coordinates}, ${center}, ${range} + ${buffer})`;
    }

    const heading = target
      ? sql`ST_Azimuth(${center}, ${target})`
      : sql`radians(${bearing})`;

    const sector = createSector(center, heading, range, spread);

    return sql`ST_DWithin(${places.coordinates}, ${sector}, ${buffer})`;
  },
});
