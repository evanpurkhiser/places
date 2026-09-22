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
    'Match an attached discovery source. Arguments match the same source and its place association. An empty call matches any source; ! excludes places with a matching source.',
  examples: [
    {query: 'source[instagram]', description: 'Places discovered on Instagram.'},
    {
      query: 'source[id:"10000000-0000-4000-8000-000000000001"]',
      description: 'Places attached to a specific source UUID.',
    },
    {
      query: 'source[instagram, text:coffee]',
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
  parameters: {
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
});
