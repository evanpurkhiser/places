import {sourceType} from '@places/common/contract/source';
import type {FilterCompilerFor} from '@places/common/filter-engine';
import type {source as sourceDefinition} from '@places/common/filter-engine/filters/source';
import {and, eq, exists, or, sql, type SQL} from 'drizzle-orm';
import {QueryBuilder} from 'drizzle-orm/pg-core';

import {places, placeSources, sources} from '../../db/schema.ts';
import {matchInstagramCaption} from '../../importers/instagram/filter-engine.ts';
import type {Context} from '../context.ts';

import {matchText} from './text.ts';

const queryBuilder = new QueryBuilder();

const attachedSource = (predicate?: SQL): SQL =>
  exists(
    queryBuilder
      .select({id: sources.id})
      .from(placeSources)
      .innerJoin(sources, eq(sources.id, placeSources.sourceId))
      .where(and(eq(placeSources.placeId, places.id), predicate)),
  );

function matchSourceType(value: string): SQL {
  const parsed = sourceType.safeParse(value.toLowerCase());
  return parsed.success ? eq(sources.type, parsed.data) : sql`false`;
}

export const sourceCompiler = {
  compile: ({type, id, url, text}): SQL =>
    attachedSource(
      and(
        type ? matchSourceType(type.value) : undefined,
        id ? eq(sources.id, id.value) : undefined,
        url ? eq(sources.url, url.value) : undefined,
        text
          ? or(
              matchText(sources.description, text.value, text.operator),
              matchInstagramCaption(text.value, text.operator),
              matchText(placeSources.description, text.value, text.operator),
            )
          : undefined,
      ),
    ),
  presence: () => attachedSource(),
} satisfies FilterCompilerFor<typeof sourceDefinition, SQL, Context>;
