import {defineFilter} from '../definitions.ts';
import {equality} from '../operators.ts';
import {textLiteral} from '../values/text-literal.ts';
import {text} from '../values/text.ts';
import {uuid} from '../values/uuid.ts';

export const source = defineFilter({
  name: 'source',
  supportsPresence: true,
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
});
