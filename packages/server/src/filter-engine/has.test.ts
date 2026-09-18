import {createFilterEngine, defineFilter} from '@places/common/filter-engine';
import {sql, type SQL} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {expect, it, vi} from 'vitest';

import {createGooglePlaces} from '../services/google/index.ts';

import type {Context} from './context.ts';
import {property} from './data-types/property.ts';
import {has} from './has.ts';

const dialect = new PgDialect();

function makeEngine(propertyName: string, presence: (context: Context) => SQL) {
  return createFilterEngine<SQL, Context>({
    types: [property],
    filters: [
      has,
      defineFilter({
        name: propertyName,
        description: 'Test presence property.',
        positional: [],
        compile: () => sql`true`,
        presence,
      }),
    ],
    boolean: {
      all: () => sql`true`,
      and: predicates => sql`(${sql.join(predicates, sql` and `)})`,
      or: predicates => sql`(${sql.join(predicates, sql` or `)})`,
      not: predicate => sql`not (${predicate})`,
    },
  });
}

it('uses the invoking engine registry and passes context to presence handlers', async () => {
  const firstPresence = vi.fn((_context: Context) => sql`true`);
  const secondPresence = vi.fn((_context: Context) => sql`false`);
  const first = makeEngine('custom', firstPresence);
  const second = makeEngine('custom', secondPresence);
  const context = {
    google: createGooglePlaces(),
    tagExists: vi.fn(),
    resolvePoint: vi.fn(),
  };

  for (const [engine, expected] of [
    [first, 'true'],
    [second, 'false'],
  ] as const) {
    const resolved = await engine.resolve(engine.prepare('has[custom]'), context);
    expect(dialect.sqlToQuery(engine.compile(resolved, context)).sql).toBe(expected);
  }

  expect(firstPresence).toHaveBeenCalledExactlyOnceWith(context);
  expect(secondPresence).toHaveBeenCalledExactlyOnceWith(context);
});

it('validates presence against each engine during preparation', () => {
  const presence = vi.fn((_context: Context) => sql`true`);
  const first = makeEngine('custom', presence);
  const second = makeEngine('other', presence);

  expect(() => first.prepare('has[custom]')).not.toThrow();

  for (const name of ['custom', 'notes', 'has', 'constructor']) {
    expect(() => second.prepare(`has[${name}]`)).toThrow(
      `Presence is not supported for ${name}`,
    );
  }

  expect(presence).not.toHaveBeenCalled();
});
