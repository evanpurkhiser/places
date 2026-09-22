import {defineFunction} from '../definitions.ts';
import {distance} from '../values/distance.ts';
import {geographicPoint} from '../values/geographic-point.ts';
import {geographicPredicate} from '../values/geographic-predicate.ts';

export const radius = defineFunction({
  name: 'radius',
  description: 'Match places at most the given geographic distance from a point.',
  parameters: {
    origin: {description: 'Center point.', type: geographicPoint},
    distance: {description: 'Maximum distance from the center.', type: distance},
  },
  returns: geographicPredicate,
  evaluate: ({origin, distance}) => ({
    kind: 'radius' as const,
    origin: origin.value,
    distance: distance.value,
  }),
});
