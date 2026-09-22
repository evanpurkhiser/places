import {SearchError} from '@places/common/search';
import {PgDialect} from 'drizzle-orm/pg-core';
import {describe, expect, it, vi} from 'vitest';

import {placeFilterEngine} from '../index.ts';

const context = {
  now: Date.now(),
  tagExists: vi.fn(),
  resolvePoint: vi.fn(),
};

async function compile(query: string) {
  const prepared = placeFilterEngine.prepare(query);
  const resolved = await placeFilterEngine.resolve(prepared, context);

  return new PgDialect().sqlToQuery(placeFilterEngine.compile(resolved));
}

describe('source filters', () => {
  it.each([
    ['source[id:invalid]', 'invalid_value'],
    ['source[instagram, type:instagram]', 'duplicate_argument'],
    ['source[instagram, other, more, values, extra]', 'argument_count'],
    ['source[type:instagram, type:instagram]', 'duplicate_argument'],
    ['source[unknown:value]', 'unknown_argument'],
    ['source[type:>instagram]', 'invalid_operator'],
    ['source[username:alice]', 'unknown_argument'],
  ])('validates %s before querying the database', (query, code) => {
    try {
      placeFilterEngine.prepare(query);
      expect.fail('Expected invalid source filter');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).diagnostics[0]).toMatchObject({
        code,
        location: {start: {line: 1}},
      });
    }
  });

  it('parameterizes identifiers, URLs, and text', async () => {
    const result = await compile(
      `source[type:INSTAGRAM, url:"https://example.com/a'b", text:"100%_good"]`,
    );

    expect(result.params).toEqual([
      'instagram',
      "https://example.com/a'b",
      '%100\\%\\_good%',
      'instagram',
      '%100\\%\\_good%',
      '%100\\%\\_good%',
    ]);
    expect(result.sql).not.toContain("a'b");
  });

  it('uses the positional argument as the source type', async () => {
    expect(await compile('source[INSTAGRAM, text:coffee]')).toEqual(
      await compile('source[type:INSTAGRAM, text:coffee]'),
    );
  });

  it('treats empty type and URL literals as unmatched values', async () => {
    const emptyType = await compile('source[type:""]');
    const emptyUrl = await compile('source[url:""]');

    expect(emptyType.sql).toContain('false');
    expect(emptyUrl.params).toEqual(['']);
  });

  it('treats an empty source call as presence', async () => {
    expect(await compile('source[]')).toEqual(await compile('has[source]'));
  });
});
