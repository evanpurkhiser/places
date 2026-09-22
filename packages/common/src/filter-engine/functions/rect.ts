import {defineFunction, InvalidValueError} from '../definitions.ts';
import {geographicPoint} from '../values/geographic-point.ts';
import {geographicPredicate} from '../values/geographic-predicate.ts';

export const rect = defineFunction({
  name: 'rect',
  description:
    'Match places inside a longitude/latitude rectangle, including its edges. A west longitude greater than east crosses the antimeridian.',
  parameters: {
    topLeft: {description: 'Northwest corner.', type: geographicPoint},
    bottomRight: {description: 'Southeast corner.', type: geographicPoint},
  },
  returns: geographicPredicate,
  evaluate: ({topLeft, bottomRight}) => {
    if (topLeft.value.latitude < bottomRight.value.latitude) {
      throw new InvalidValueError(
        'rect topLeft latitude must be at least bottomRight latitude',
      );
    }

    return {
      kind: 'rect' as const,
      topLeft: topLeft.value,
      bottomRight: bottomRight.value,
    };
  },
});
