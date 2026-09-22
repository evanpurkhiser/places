import {createFilterEngine, defineFilter} from '@places/common/filter-engine';
import {sql, type SQL} from 'drizzle-orm';

import type {Database} from '../db/index.ts';
import {places} from '../db/schema.ts';
import type {GooglePlaces} from '../services/google/index.ts';

import {createContext, type Context} from './context.ts';
import {degrees} from './data-types/degrees.ts';
import {distance} from './data-types/distance.ts';
import {duration} from './data-types/duration.ts';
import {geographicPoint} from './data-types/geographic-point.ts';
import {geographicPredicate} from './data-types/geographic-predicate.ts';
import {latitude} from './data-types/latitude.ts';
import {longitude} from './data-types/longitude.ts';
import {property} from './data-types/property.ts';
import {tagName} from './data-types/tag-name.ts';
import {textLiteral} from './data-types/text-literal.ts';
import {text} from './data-types/text.ts';
import {time} from './data-types/time.ts';
import {uuid} from './data-types/uuid.ts';
import {point} from './functions/point.ts';
import {radius} from './functions/radius.ts';
import {rect} from './functions/rect.ts';
import {sector} from './functions/sector.ts';
import {has} from './has.ts';
import {location} from './location.ts';
import {open} from './open.ts';
import {equality} from './operators.ts';
import {tag} from './tag.ts';
import {matchText, present} from './text.ts';

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

export const placeFilterEngine = createFilterEngine<SQL, Context>({
  types: [
    text,
    uuid,
    textLiteral,
    tagName,
    property,
    distance,
    duration,
    time,
    degrees,
    longitude,
    latitude,
    geographicPoint,
    geographicPredicate,
  ],
  filters: [tag, ...textFilters, has, location, open],
  functions: [point, radius, rect, sector],
  boolean: {
    all: () => sql`true`,
    and: predicates => sql`(${sql.join(predicates, sql` and `)})`,
    or: predicates => sql`(${sql.join(predicates, sql` or `)})`,
    not: predicate => sql`not (${predicate})`,
  },
});

export async function compilePlaceQuery(
  query: string,
  {db, google}: {db: Database; google?: GooglePlaces},
): Promise<SQL> {
  const prepared = placeFilterEngine.prepare(query);
  const context = createContext(db, google);
  const resolved = await placeFilterEngine.resolve(prepared, context);

  return placeFilterEngine.compile(resolved, context);
}
