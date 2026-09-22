import {PgDialect} from 'drizzle-orm/pg-core';
import {expect, it, vi} from 'vitest';

import {placeFilterEngine} from '../index.ts';

async function compile(query: string, names = ['type.cafe', 'type.bar', 'star.*']) {
  const context = {
    now: Date.now(),
    tagExists: (name: string) => Promise.resolve(names.includes(name)),
    resolvePoint: vi.fn(),
  };
  const resolved = await placeFilterEngine.resolve(
    placeFilterEngine.prepare(query),
    context,
  );

  return new PgDialect().sqlToQuery(placeFilterEngine.compile(resolved));
}

it('builds correlated membership with notes on the same assignment', async () => {
  const result = await compile('tag[type.cafe, notes:outlet]');

  expect(result.sql).toContain('exists');
  expect(result.sql).toContain('"place_tags"."place_id" = "places"."id"');
  expect(result.sql).toContain('"place_tags"."note"');
  expect(result.params).toEqual(['type.cafe', '%outlet%']);
});

it('negates the complete membership predicate', async () => {
  const result = await compile('!tag[=type.cafe]');

  expect(result.sql).toMatch(/not \(exists/);
  expect(result.sql).not.toContain('<> $');
});

it('validates exact names while permitting unmatched patterns', async () => {
  await expect(compile('!tag[typo]')).rejects.toThrow('Unknown tag: typo');
  await expect(compile('tag[typo.*]')).resolves.toMatchObject({params: ['typo.%']});
});

it('normalizes after preserving wildcard positions and SQL metacharacters', async () => {
  const result = await compile(String.raw`tag["  İ:ab\**%_\\  "]`);

  expect(result.params).toEqual(['i\u0307:ab*%\\%\\_\\\\']);
});

it('makes stars literal for equality', async () => {
  await expect(compile('tag[=star.*]')).resolves.toMatchObject({params: ['star.*']});
});
