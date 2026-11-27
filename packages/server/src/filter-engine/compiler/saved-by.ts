import type {FilterCompilerFor} from '@places/common/filter-engine';
import type {savedBy as savedByDefinition} from '@places/common/filter-engine/filters/saved-by';
import {and, eq, exists, type SQL} from 'drizzle-orm';
import {QueryBuilder} from 'drizzle-orm/pg-core';

import {places, placeSaves, users} from '../../db/schema.ts';
import type {Context} from '../context.ts';

const queryBuilder = new QueryBuilder();

export const savedByCompiler = {
  compile: ({username}) =>
    exists(
      queryBuilder
        .select({placeId: placeSaves.placeId})
        .from(placeSaves)
        .innerJoin(users, eq(users.id, placeSaves.userId))
        .where(
          and(eq(placeSaves.placeId, places.id), eq(users.username, username.value)),
        ),
    ),
} satisfies FilterCompilerFor<typeof savedByDefinition, SQL, Context>;
