import {SearchError} from '@places/common/search';
import {PgDialect} from 'drizzle-orm/pg-core';
import {describe, expect, it} from 'vitest';

import {placeFilterEngine} from './index.ts';

const dialect = new PgDialect();
async function compile(query: string) {
  const prepared = placeFilterEngine.prepare(query);
  const resolved = await placeFilterEngine.resolve(prepared, null);
  return dialect.sqlToQuery(placeFilterEngine.compile(resolved, null));
}

describe('Places text predicates', () => {
  it.each([
    ['unknown[x]', 'unknown_filter'],
    ['text[coffee]', 'unknown_filter'],
    ['coffee', 'syntax'],
    ['constructor[x]', 'unknown_filter'],
    ['name[]', 'argument_count'],
    ['name[unknown()]', 'unknown_function'],
    ['name[@home]', 'invalid_value'],
    ['notes[>a]', 'invalid_operator'],
    ['name[!=coffee]', 'syntax'],
  ])('validates registered capabilities: %s', (query, code) => {
    try {
      placeFilterEngine.prepare(query);
      expect.fail('Expected invalid query');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).diagnostics[0]).toMatchObject({
        code,
        location: {start: {line: 1}},
      });
    }
  });

  it('keeps names and patterns parameterized', async () => {
    const result = await compile(`name["x' OR 1=1 --"]`);
    expect(result.sql).not.toContain('1=1');
    expect(result.params).toEqual(["%x' OR 1=1 --%"]);
  });

  it('matches text fields with substring, literal equality, and wildcard semantics', async () => {
    expect((await compile('address[Broadway]')).params).toEqual(['%Broadway%']);
    expect((await compile('name[="La Cabra"]')).params).toEqual(['La Cabra']);
    expect((await compile('notes[="*outlet*"]')).params).toEqual(['*outlet*']);
    expect((await compile(String.raw`notes["a\*b*%_"]`)).params).toEqual([
      '%a*b%\\%\\_%',
    ]);
  });

  it('composes Boolean predicates', async () => {
    const result = await compile('(name[cafe] OR address[Broadway]) !notes[outlet]');
    expect(result.sql).toContain(' or ');
    expect(result.sql).toContain(' and ');
    expect(result.sql).toContain('not (');
    expect((await compile('')).sql).toBe('true');
  });
});
