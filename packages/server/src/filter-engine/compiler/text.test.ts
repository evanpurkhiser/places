import {PgDialect} from 'drizzle-orm/pg-core';
import {expect, it, vi} from 'vitest';

import {placeFilterEngine} from '../index.ts';

async function compile(query: string) {
  const context = {
    now: Date.now(),
    tagExists: vi.fn(),
    resolvePoint: vi.fn(),
  };
  const resolved = await placeFilterEngine.resolve(
    placeFilterEngine.prepare(query),
    context,
  );

  return new PgDialect().sqlToQuery(placeFilterEngine.compile(resolved));
}

it('keeps text values parameterized', async () => {
  const result = await compile(`name["x' OR 1=1 --"]`);

  expect(result.sql).not.toContain('1=1');
  expect(result.params).toEqual(["%x' OR 1=1 --%"]);
});

it('compiles substring, equality, and wildcard matching', async () => {
  await expect(compile('address[Broadway]')).resolves.toMatchObject({
    params: ['%Broadway%'],
  });
  await expect(compile('name[="La Cabra"]')).resolves.toMatchObject({
    params: ['La Cabra'],
  });
  await expect(compile('notes[="*outlet*"]')).resolves.toMatchObject({
    params: ['*outlet*'],
  });
  await expect(compile(String.raw`notes["a\*b*%_"]`)).resolves.toMatchObject({
    params: ['%a*b%\\%\\_%'],
  });
});
