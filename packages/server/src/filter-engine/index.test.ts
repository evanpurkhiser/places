import {SearchError} from '@places/common/search';
import {PgDialect} from 'drizzle-orm/pg-core';
import {describe, expect, it} from 'vitest';

import {placeFilterEngine} from './index.ts';

const dialect = new PgDialect();
async function compile(query: string, names = ['type:cafe', 'type:bar', 'star:*']) {
  const context = {tagExists: (name: string) => Promise.resolve(names.includes(name))};
  const prepared = placeFilterEngine.prepare(query);
  const resolved = await placeFilterEngine.resolve(prepared, context);

  return dialect.sqlToQuery(placeFilterEngine.compile(resolved, context));
}

describe('Places SQL predicates', () => {
  it.each([
    ['800m', 800],
    ['1.5km', 1500],
    ['100ft', 30.48],
    ['.5mi', 804.672],
  ])(
    'compiles radius with %s to parameterized geography SQL',
    async (distance, meters) => {
      const result = await compile(
        `location[radius(point(-73.985, 40.726), ${distance})]`,
      );

      expect(result.sql).toContain(
        'ST_DWithin("places"."coordinates", ST_SetSRID(ST_MakePoint(',
      );
      expect(result.sql).toContain('4326)::geography');
      expect(result.params).toEqual([-73.985, 40.726, meters]);
    },
  );

  it.each([
    'point(181, 0), 1m',
    'point(0, -91), 1m',
    'point(NaN, 0), 1m',
    'point("", 0), 1m',
    'point(0x10, 0), 1m',
    'point(0, 0), 0m',
    'point(0, 0), -1m',
    'point(0, 0), 1',
    'point(0, 0), 1yd',
    'point(0, 0), NaNkm',
    '"New York", 1mi',
  ])('rejects invalid radius arguments: %s', arguments_ => {
    expect(() => placeFilterEngine.prepare(`location[radius(${arguments_})]`)).toThrow(
      SearchError,
    );
  });

  it('accepts coordinate boundaries and composes radius with other filters', async () => {
    const result = await compile('name[cafe] !location[radius(point(-180, 90), 1km)]');

    expect(result.params).toEqual(['%cafe%', -180, 90, 1000]);
    expect(result.sql).toContain('and not (ST_DWithin(');
    await expect(compile('location[radius(point(180, -90), 1m)]')).resolves.toBeDefined();
  });

  it.each([
    ['unknown[x]', 'unknown_filter'],
    ['text[coffee]', 'unknown_filter'],
    ['coffee', 'syntax'],
    ['constructor[x]', 'unknown_filter'],
    ['tag[]', 'argument_count'],
    ['tag[a, b]', 'argument_count'],
    ['tag[x, typo:y]', 'unknown_argument'],
    ['tag[x, notes:y, notes:z]', 'duplicate_argument'],
    ['tag[unknown()]', 'unknown_function'],
    ['tag[@home]', 'invalid_value'],
    ['tagged[false]', 'unknown_filter'],
    ['tag[>type:cafe]', 'invalid_operator'],
    ['tag[!=type:cafe, notes:outlets]', 'syntax'],
    ['tag[!=type:cafe]', 'syntax'],
    ['name[!=coffee]', 'syntax'],
    ['address[!=Broadway]', 'syntax'],
    ['notes[!=coffee]', 'syntax'],
    ['tag[type:cafe, notes:!=outlets]', 'syntax'],
    ['tag[""]', 'invalid_value'],
    ['created[>=2026-09-01]', 'unknown_filter'],
    ['hours[open(now)]', 'unknown_filter'],
    ['saved[work-friendly]', 'unknown_filter'],
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

  it('builds correlated membership with notes on the same assignment', async () => {
    const result = await compile('tag[type:cafe, notes:outlet]');

    expect(result.sql).toContain('exists');
    expect(result.sql).toContain('"place_tags"."place_id" = "places"."id"');
    expect(result.sql).toContain('"place_tags"."note"');
    expect(result.params).toEqual(['type:cafe', '%outlet%']);
  });

  it('negates membership instead of checking a different assigned tag', async () => {
    const result = await compile('!tag[=type:cafe]');

    expect(result.sql).toMatch(/not \(exists/);
    expect(result.sql).not.toContain('<> $');
  });

  it('rejects exact missing tags even under negation, but permits empty patterns', async () => {
    await expect(compile('!tag[typo]')).rejects.toThrow('Unknown tag: typo');
    await expect(compile('tag[typo:*]')).resolves.toMatchObject({params: ['typo:%']});
  });

  it('normalizes after preserving wildcard positions and escapes SQL metacharacters', async () => {
    const result = await compile(String.raw`tag["  İ:ab\**%_\\  "]`);

    expect(result.params).toEqual(['i\u0307:ab*%\\%\\_\\\\']);
  });

  it('makes stars literal for equality', async () => {
    expect((await compile('tag[=star:*]')).params).toEqual(['star:*']);
    expect((await compile('notes[="*outlet*"]')).params).toEqual(['*outlet*']);
  });

  it('supports boolean composition, presence hooks', async () => {
    const result = await compile('(tag[type:cafe] OR !has[tag]) AND !has[notes]');

    expect(result.sql).toContain(' or ');
    expect(result.sql).toContain(' and ');
    expect(result.sql).toContain('not (');
    expect(result.sql).toContain('"places"."user_note" is not null');
    expect((await compile('')).sql).toBe('true');
  });

  it('rejects unsupported filters, functions, presence, and operators', async () => {
    for (const query of [
      'location[radius(@home, 1mi)]',
      'notes[nope()]',
      'has[hours]',
      'notes[>a]',
      'tag[type:cafe, other:x]',
    ]) {
      await expect(compile(query)).rejects.toThrow();
    }
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
