import {valueType} from '@places/common/filter-engine';
import type {SQL} from 'drizzle-orm';

export const geographicPredicate = valueType<SQL>({
  name: 'geographic predicate',
  description: 'A geographic condition produced by radius, rect, or sector.',
});
