import {sourceType} from '@places/common/contract/source';
import {defineFilter} from '@places/common/filter-engine';
import {and, eq, exists, or, sql, type SQL} from 'drizzle-orm';
import {QueryBuilder} from 'drizzle-orm/pg-core';

import {places, placeSources, sources} from '../db/schema.ts';
import {matchInstagramCaption} from '../importers/instagram/filter-engine.ts';

import {textLiteral} from './data-types/text-literal.ts';
import {text} from './data-types/text.ts';
import {uuid} from './data-types/uuid.ts';
import {equality} from './operators.ts';
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

export const source = defineFilter({
  name: 'source',
  description:
    'Match an attached discovery source. All arguments match the same source and its place association. An empty call matches any source; ! excludes places with a matching source.',
  examples: [
    {query: 'source[type:instagram]', description: 'Places discovered on Instagram.'},
    {
      query: 'source[id:"10000000-0000-4000-8000-000000000001"]',
      description: 'Places attached to a specific source UUID.',
    },
    {
      query: 'source[type:instagram, text:coffee]',
      description: 'Places with Instagram discovery context mentioning coffee.',
    },
    {
      query: 'source[url:"https://www.instagram.com/p/POST/"]',
      description: 'Places attached to this exact saved post URL.',
    },
    {
      query: 'source[text:"date night"]',
      description:
        'Search source descriptions, Instagram captions, and association descriptions.',
    },
    {query: 'has[source]', description: 'Places with at least one attached source.'},
    {query: '!has[source]', description: 'Places without attached sources.'},
  ],
  positional: [],
  named: {
    type: {
      description:
        'Exact provider type, ignoring case, such as instagram. Unknown types match no places.',
      type: textLiteral,
      operators: equality,
      optional: true,
    },
    id: {
      description: 'Exact source UUID.',
      type: uuid,
      operators: equality,
      optional: true,
    },
    url: {
      description: 'Exact saved source URL, including case and trailing slash.',
      type: textLiteral,
      operators: equality,
      optional: true,
    },
    text: {
      description:
        'Match any source description, Instagram caption, or description on this place association.',
      type: text,
      operators: equality,
      optional: true,
    },
  },
  compile: ({named}): SQL =>
    attachedSource(
      and(
        named.type ? matchSourceType(named.type.value) : undefined,
        named.id ? eq(sources.id, named.id.value) : undefined,
        named.url ? eq(sources.url, named.url.value) : undefined,
        named.text
          ? or(
              matchText(sources.description, named.text.value, named.text.operator),
              matchInstagramCaption(named.text.value, named.text.operator),
              matchText(placeSources.description, named.text.value, named.text.operator),
            )
          : undefined,
      ),
    ),
  presence: () => attachedSource(),
});
