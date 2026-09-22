import {defineFunction} from '@places/common/filter-engine';
import {sql} from 'drizzle-orm';

import {places} from '../../db/schema.ts';
import {distance} from '../data-types/distance.ts';
import {geographicPoint} from '../data-types/geographic-point.ts';
import {geographicPredicate} from '../data-types/geographic-predicate.ts';

export const radius = defineFunction({
  name: 'radius',
  description: 'Match places at most the given geographic distance from a point.',
  parameters: {
    origin: {description: 'Center point.', type: geographicPoint},
    distance: {description: 'Maximum distance from the center.', type: distance},
  },
  returns: geographicPredicate,
  resolve: ({origin, distance}) =>
    sql`ST_DWithin(${places.coordinates}, ST_SetSRID(ST_MakePoint(${origin.value.longitude}, ${origin.value.latitude}), 4326)::geography, ${distance.value})`,
});
