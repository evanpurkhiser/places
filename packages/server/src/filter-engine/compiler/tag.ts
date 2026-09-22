import type {FilterCompilerFor} from '@places/common/filter-engine';
import type {tag as tagDefinition} from '@places/common/filter-engine/filters/tag';
import {sql, type SQL} from 'drizzle-orm';

import {places, placeTags, tags} from '../../db/schema.ts';
import type {Context} from '../context.ts';

import {likePattern, matchText} from './text.ts';

export const tagPresence = () => sql`exists (
  select 1 from ${placeTags}
  inner join ${tags} on ${tags.id} = ${placeTags.tagId}
  where ${placeTags.placeId} = ${places.id} and ${tags.archived} = false
)`;

export const tagCompiler = {
  compile: ({name, notes}): SQL => {
    const normalized = name.value.value.trim().toLowerCase();
    const exact = name.operator !== null || name.value.wildcards.length === 0;

    // Escape before normalizing so trimming and Unicode case conversion cannot
    // shift the parser's wildcard offsets.
    const nameMatch = exact
      ? sql`${tags.name} = ${normalized}`
      : sql`${tags.name} like ${likePattern(name.value, false).trim().toLowerCase()} escape '\\'`;
    const noteMatch = notes
      ? sql`and ${matchText(placeTags.note, notes.value, notes.operator)}`
      : sql``;
    return sql`exists (
        select 1 from ${placeTags}
        inner join ${tags} on ${tags.id} = ${placeTags.tagId}
        where ${placeTags.placeId} = ${places.id} and ${nameMatch} ${noteMatch}
      )`;
  },
  presence: tagPresence,
} satisfies FilterCompilerFor<typeof tagDefinition, SQL, Context>;
