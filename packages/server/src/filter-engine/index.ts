import {createFilterEngine, defineFilter} from '@places/common/filter-engine';
import {sql, type SQL} from 'drizzle-orm';

import {places} from '../db/schema.ts';

import {matchText, present} from './text.ts';
import {equality, text} from './values.ts';

const textFilters = (
  [
    [
      'name',
      places.name,
      'Match the saved place name.',
      [
        {query: 'name[coffee]', description: 'Names containing coffee.'},
        {query: 'name[="La Cabra"]', description: 'Exactly La Cabra, ignoring case.'},
        {query: '!name[coffee]', description: 'Names that do not contain coffee.'},
      ],
    ],
    [
      'address',
      places.formattedAddress,
      'Match the formatted street address.',
      [
        {
          query: 'address["Broadway"]',
          description: 'Formatted addresses containing Broadway.',
        },
      ],
    ],
    [
      'notes',
      places.userNote,
      'Match the general place note. Absent or empty notes fail positive matches.',
      [
        {
          query: 'notes[espresso]',
          description: 'General place notes mentioning espresso.',
        },
        {
          query: '!notes[espresso]',
          description:
            'Places without espresso in their general note, including places with no note.',
        },
      ],
    ],
  ] as const
).map(([name, column, description, examples]) =>
  defineFilter({
    name,
    description,
    examples,
    positional: [
      {
        name: 'pattern',
        description: 'Text or wildcard pattern to match.',
        type: text,
        operators: equality,
      },
    ] as const,
    compile: ({positional: [argument]}): SQL =>
      matchText(column, argument.value, argument.operator),
    presence: (): SQL => present(column),
  }),
);

export const placeFilterEngine = createFilterEngine<SQL, unknown>({
  types: [text],
  filters: textFilters,
  boolean: {
    all: () => sql`true`,
    and: predicates => sql`(${sql.join(predicates, sql` and `)})`,
    or: predicates => sql`(${sql.join(predicates, sql` or `)})`,
    not: predicate => sql`not (${predicate})`,
  },
});
