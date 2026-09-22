import {placeFilterEngineDefinition} from '@places/common/filter-engine/places';
import {SearchError} from '@places/common/search';
import {PgDialect} from 'drizzle-orm/pg-core';
import {describe, expect, it, vi} from 'vitest';

import {placeFilterEngine} from './index.ts';

async function compile(query: string) {
  const context = {
    now: Date.now(),
    tagExists: (name: string) => Promise.resolve(name === 'type.cafe'),
    resolvePoint: vi.fn(),
  };
  const resolved = await placeFilterEngine.resolve(
    placeFilterEngine.prepare(query),
    context,
  );

  return new PgDialect().sqlToQuery(placeFilterEngine.compile(resolved));
}

describe('assembled Places filter engine', () => {
  it('implements every shared filter, function, and value definition', () => {
    const description = placeFilterEngine.describe();

    expect(description.filters.map(filter => filter.name)).toEqual(
      Object.values(placeFilterEngineDefinition.filters).map(filter => filter.name),
    );
    expect(description.functions.map(fn => fn.name)).toEqual(
      Object.values(placeFilterEngineDefinition.functions).map(fn => fn.name),
    );
    expect(description.values.map(value => value.name)).toEqual(
      Object.values(placeFilterEngineDefinition.values).map(value => value.name),
    );
  });

  it.each([
    ['unknown[x]', 'unknown_filter'],
    ['text[coffee]', 'unknown_filter'],
    ['coffee', 'syntax'],
    ['constructor[x]', 'unknown_filter'],
    ['tag[]', 'missing_argument'],
    ['tag[a, b, c]', 'argument_count'],
    ['tag[a, name:b]', 'duplicate_argument'],
    ['tag[x, typo:y]', 'unknown_argument'],
    ['tag[x, notes:y, notes:z]', 'duplicate_argument'],
    ['tag[unknown()]', 'unknown_function'],
    ['tag[@home]', 'invalid_value'],
    ['tagged[false]', 'unknown_filter'],
    ['tag[>type.cafe]', 'invalid_operator'],
    ['tag[!=type.cafe]', 'syntax'],
    ['name[!=coffee]', 'syntax'],
    ['tag[""]', 'invalid_value'],
    ['created[>=2026-09-01]', 'unknown_filter'],
    ['hours[open(now)]', 'unknown_filter'],
  ])('validates the registered surface: %s', (query, code) => {
    try {
      placeFilterEngine.prepare(query);
      expect.fail('Expected invalid query');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).diagnostics[0]).toMatchObject({code});
    }
  });

  it('composes predicates and dispatches presence compilers', async () => {
    const result = await compile('(tag[type.cafe] OR !has[tag]) AND !has[notes]');

    expect(result.sql).toContain(' or ');
    expect(result.sql).toContain(' and ');
    expect(result.sql).toContain('not (');
    expect(result.sql).toContain('"places"."user_note" is not null');
    const empty = await compile('');
    expect(empty.sql).toBe('true');
  });
});
