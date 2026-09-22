import {sql, type SQL} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {expect, it, vi} from 'vitest';

import type {Context} from '../context.ts';

import {hasCompiler} from './has.ts';

const dialect = new PgDialect();
const context: Context = {
  now: Date.now(),
  tagExists: vi.fn(),
  resolvePoint: vi.fn(),
};

it('delegates to the selected presence compiler with the request context', () => {
  const presence = vi.fn((_context: Context) => sql`true`);
  const result = hasCompiler.compile(
    {property: {value: 'notes', operator: null}},
    context,
    {get: name => (name === 'notes' ? presence : undefined)},
  );

  expect(dialect.sqlToQuery(result).sql).toBe('true');
  expect(presence).toHaveBeenCalledExactlyOnceWith(context);
});

it('rejects a resolved property without a presence compiler', () => {
  expect(() =>
    hasCompiler.compile({property: {value: 'missing', operator: null}}, context, {
      get: (): ((context: Context) => SQL) | undefined => undefined,
    }),
  ).toThrow('Presence is not supported for missing');
});
