import {defineFunction, InvalidValueError} from '@places/common/filter-engine';
import {sql} from 'drizzle-orm';

import {places} from '../../db/schema.ts';
import {geographicPoint} from '../data-types/geographic-point.ts';
import {geographicPredicate} from '../data-types/geographic-predicate.ts';

export const rect = defineFunction({
  name: 'rect',
  description:
    'Match places inside a longitude/latitude rectangle, including its edges. A west longitude greater than east crosses the antimeridian.',
  parameters: {
    topLeft: {description: 'Northwest corner.', type: geographicPoint},
    bottomRight: {description: 'Southeast corner.', type: geographicPoint},
  },
  returns: geographicPredicate,
  resolve: ({topLeft, bottomRight}) => {
    const {longitude: west, latitude: north} = topLeft.value;
    const {longitude: east, latitude: south} = bottomRight.value;

    if (north < south) {
      throw new InvalidValueError(
        'rect topLeft latitude must be at least bottomRight latitude',
      );
    }

    // Compare degrees directly so edges follow map bounds, including wide viewports.
    const lng = sql`ST_X(${places.coordinates}::geometry)`;
    const lat = sql`ST_Y(${places.coordinates}::geometry)`;
    const longitudeRange =
      west > east
        ? sql`(${lng} >= ${west} or ${lng} <= ${east})`
        : sql`${lng} between ${west} and ${east}`;

    return sql`(${lat} between ${south} and ${north} and ${longitudeRange})`;
  },
});
