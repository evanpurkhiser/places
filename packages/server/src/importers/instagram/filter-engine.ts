import type {Operator, StringValue} from '@places/common/search';
import {and, eq, sql, type SQL} from 'drizzle-orm';

import {sources} from '../../db/schema.ts';
import {matchText} from '../../filter-engine/compiler/text.ts';

export function matchInstagramCaption(
  value: StringValue,
  operator: Operator | null,
): SQL | undefined {
  return and(
    eq(sources.type, 'instagram'),
    matchText(sql`${sources.data}->>'caption'`, value, operator),
  );
}
