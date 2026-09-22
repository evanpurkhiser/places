import {
  implementFilterEngine,
  type FilterCompilerFor,
  type FilterEngineImplementation,
} from '@places/common/filter-engine';
import type {name as nameDefinition} from '@places/common/filter-engine/filters/text';
import {placeFilterEngineDefinition} from '@places/common/filter-engine/places';
import {sql, type SQL, type SQLWrapper} from 'drizzle-orm';

import type {Database} from '../db/index.ts';
import {places} from '../db/schema.ts';
import type {GooglePlaces} from '../services/google/index.ts';

import {hasCompiler} from './compiler/has.ts';
import {locationCompiler} from './compiler/location.ts';
import {openCompiler} from './compiler/open.ts';
import {sourceCompiler} from './compiler/source.ts';
import {tagCompiler} from './compiler/tag.ts';
import {matchText, present} from './compiler/text.ts';
import {createContext, type Context} from './context.ts';
import {geographicPointResolver} from './resolver/geographic-point.ts';
import {tagNameResolver} from './resolver/tag-name.ts';
import {timeResolver} from './resolver/time.ts';

function textCompiler(
  column: SQLWrapper,
): FilterCompilerFor<typeof nameDefinition, SQL, Context> {
  return {
    compile: ({pattern}): SQL => matchText(column, pattern.value, pattern.operator),
    presence: (): SQL => present(column),
  };
}

const implementation = {
  valueResolvers: {
    tagName: tagNameResolver,
    time: timeResolver,
    geographicPoint: geographicPointResolver,
  },
  filters: {
    tag: tagCompiler,
    source: sourceCompiler,
    name: textCompiler(places.name),
    address: textCompiler(places.formattedAddress),
    notes: textCompiler(places.userNote),
    has: hasCompiler,
    location: locationCompiler,
    open: openCompiler,
  },
  boolean: {
    all: () => sql`true`,
    and: predicates => sql`(${sql.join(predicates, sql` and `)})`,
    or: predicates => sql`(${sql.join(predicates, sql` or `)})`,
    not: predicate => sql`not (${predicate})`,
  },
} satisfies FilterEngineImplementation<typeof placeFilterEngineDefinition, SQL, Context>;

export const placeFilterEngine = implementFilterEngine(
  placeFilterEngineDefinition,
  implementation,
);

export function compilePlaceQuery(
  query: string,
  {db, google}: {db: Database; google?: GooglePlaces},
): Promise<SQL> {
  const prepared = placeFilterEngine.prepare(query);
  const context = createContext(db, google);
  return placeFilterEngine.execute(prepared, context);
}
