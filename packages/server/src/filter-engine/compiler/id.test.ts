import {SearchError} from '@places/common/search';
import {PgDialect} from 'drizzle-orm/pg-core';
import {describe, expect, it, vi} from 'vitest';

import {randomUUID} from 'node:crypto';

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

describe('place ID filters', () => {
  it('matches an exact saved place UUID', async () => {
    const id = randomUUID();

    expect(await compile(`id[${id}]`)).toMatchObject({params: [id]});
  });

  it('rejects an invalid UUID before querying the database', () => {
    try {
      placeFilterEngine.prepare('id[invalid]');
      expect.fail('Expected invalid place ID filter');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).diagnostics[0]).toMatchObject({
        code: 'invalid_value',
        location: {start: {line: 1}},
      });
    }
  });
});
