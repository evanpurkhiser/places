import {defineFunction, InvalidValueError} from '../definitions.ts';
import {degrees} from '../values/degrees.ts';
import {distance} from '../values/distance.ts';
import {geographicPoint} from '../values/geographic-point.ts';
import {geographicPredicate} from '../values/geographic-predicate.ts';

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
  parameters: {
    origin: {description: 'Starting point.', type: geographicPoint},
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

    const [heading] = headings;

    if (!heading || headings.length !== 1) {
      return 'sector requires exactly one of towards or bearing';
    }

    if (heading.name === 'bearing' && !args.some(argument => argument.name === 'range')) {
      return 'sector requires range when bearing is specified';
    }
  },
  returns: geographicPredicate,
  evaluate: ({origin, spread, buffer, range, bearing, towards}) => {
    const spreadValue = spread?.value ?? 30;
    const bufferValue = buffer?.value ?? 200;
    const rangeValue = range?.value;
    const bearingValue = bearing?.value;
    const towardsValue = towards?.value;

    if (bearingValue !== undefined && (bearingValue < 0 || bearingValue >= 360)) {
      throw new InvalidValueError('sector bearing must be from 0deg to below 360deg');
    }

    if (spreadValue <= 0 || spreadValue > 360) {
      throw new InvalidValueError(
        'sector spread must be greater than 0deg and at most 360deg',
      );
    }

    if (rangeValue !== undefined && rangeValue >= 10_000_000) {
      throw new InvalidValueError('sector range must be less than 10000km');
    }

    if (
      towardsValue &&
      towardsValue.latitude === origin.value.latitude &&
      (Math.abs(towardsValue.latitude) === 90 ||
        (towardsValue.longitude - origin.value.longitude) % 360 === 0)
    ) {
      throw new InvalidValueError('sector towards must differ from its origin');
    }

    if (towardsValue && rangeValue === undefined) {
      const radians = (degrees: number) => (degrees * Math.PI) / 180;
      const originLatitude = radians(origin.value.latitude);
      const targetLatitude = radians(towardsValue.latitude);
      const longitudeDifference = radians(
        towardsValue.longitude - origin.value.longitude,
      );
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

    const common = {
      kind: 'sector' as const,
      origin: origin.value,
      spread: spreadValue,
      buffer: bufferValue,
    };

    if (towardsValue) {
      return rangeValue === undefined
        ? {...common, towards: towardsValue}
        : {...common, towards: towardsValue, range: rangeValue};
    }

    if (bearingValue === undefined || rangeValue === undefined) {
      throw new InvalidValueError('sector requires bearing and range');
    }

    return {...common, bearing: bearingValue, range: rangeValue};
  },
});
