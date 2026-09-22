import {defineValue} from '../definitions.ts';

import type {Point} from './geographic-point.ts';

export type GeographicPredicate =
  | {kind: 'radius'; origin: Point; distance: number}
  | {kind: 'rect'; topLeft: Point; bottomRight: Point}
  | ({kind: 'sector'; origin: Point; spread: number; buffer: number} & (
      | {towards: Point; range?: number}
      | {bearing: number; range: number}
    ));

export const geographicPredicate = defineValue<GeographicPredicate>()({
  name: 'geographic predicate',
  description: 'A geographic condition produced by radius, rect, or sector.',
  literals: false,
  references: false,
});
