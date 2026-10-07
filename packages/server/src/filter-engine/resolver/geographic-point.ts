import {InvalidValueError, type ValueResolverFor} from '@places/common/filter-engine';
import type {geographicPoint} from '@places/common/filter-engine/values/geographic-point';

import type {Context} from '../context.ts';

export const geographicPointResolver = {
  resolve: (value, context: Context) =>
    typeof value === 'string' ? context.resolvePoint(value) : value,
  resolveReference(name, context: Context) {
    if (name !== 'ref') {
      throw new InvalidValueError(
        `Unknown geographic reference: @${name}. Expected @ref.`,
      );
    }

    if (!context.referencePoint) {
      throw new InvalidValueError('A reference location is required to use @ref.');
    }

    return context.referencePoint;
  },
} satisfies ValueResolverFor<typeof geographicPoint, Context>;
