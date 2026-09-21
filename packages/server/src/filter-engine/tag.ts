import {defineFilter} from '@places/common/filter-engine';
import {sql, type SQL} from 'drizzle-orm';

import {places, placeTags, tags} from '../db/schema.ts';

import {tagName} from './data-types/tag-name.ts';
import {text} from './data-types/text.ts';
import {equality} from './operators.ts';
import {likePattern, matchText} from './text.ts';

export const tagPresence = () => sql`exists (
  select 1 from ${placeTags} where ${placeTags.placeId} = ${places.id}
)`;

export const tag = defineFilter({
  name: 'tag',
  description:
    'Match an assigned tag, optionally with notes on the same assignment. Prefix with ! to select places where no assignment matches both conditions.',
  examples: [
    {query: 'tag[favorite]', description: 'Places assigned the favorite tag.'},
    {query: 'tag["date night"]', description: 'Places assigned a tag containing spaces.'},
    {query: 'tag[type.cafe]', description: 'Places assigned the type.cafe tag.'},
    {
      query: 'tag[type.*]',
      description: 'Places with a tag in the type namespace.',
    },
    {
      query: 'tag[laptop-friendly, notes:outlet]',
      description:
        'Places whose laptop-friendly tag assignment has a note mentioning outlets.',
    },
    {
      query: 'tag[laptop-friendly, notes:="power outlets"]',
      description:
        'Match an assignment whose complete note is "power outlets", ignoring case.',
    },
    {
      query: '!tag[laptop-friendly, notes:outlet]',
      description:
        'Places where no laptop-friendly assignment has a note containing outlet; includes places without the tag.',
    },
    {
      query: 'tag[laptop-friendly] !tag[laptop-friendly, notes:outlet]',
      description:
        'Require the tag, but exclude places whose assignment note mentions outlet.',
    },
  ],
  positional: [
    {
      name: 'pattern',
      description: 'Assigned tag name or wildcard pattern.',
      type: tagName,
      operators: equality,
    },
  ] as const,
  named: {
    notes: {
      description: 'Match the note on the same tag assignment.',
      type: text,
      operators: equality,
      optional: true,
    },
  },
  compile: ({positional: [name], named}): SQL => {
    const normalized = name.value.value.trim().toLowerCase();
    const exact = name.operator !== null || name.value.wildcards.length === 0;

    // Escape before normalizing so trimming and Unicode case conversion cannot
    // shift the parser's wildcard offsets.
    const nameMatch = exact
      ? sql`${tags.name} = ${normalized}`
      : sql`${tags.name} like ${likePattern(name.value, false).trim().toLowerCase()} escape '\\'`;
    const noteMatch = named.notes
      ? sql`and ${matchText(placeTags.note, named.notes.value, named.notes.operator)}`
      : sql``;
    return sql`exists (
      select 1 from ${placeTags}
      inner join ${tags} on ${tags.id} = ${placeTags.tagId}
      where ${placeTags.placeId} = ${places.id} and ${nameMatch} ${noteMatch}
    )`;
  },
  presence: tagPresence,
});
