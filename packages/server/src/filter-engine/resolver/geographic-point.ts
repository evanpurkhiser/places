import type {ValueResolverFor} from '@places/common/filter-engine';
import type {geographicPoint} from '@places/common/filter-engine/values/geographic-point';

import type {Context} from '../context.ts';

export const geographicPointResolver = {
  resolve: (value, context: Context) =>
    typeof value === 'string' ? context.resolvePoint(value) : value,
} satisfies ValueResolverFor<typeof geographicPoint, Context>;
