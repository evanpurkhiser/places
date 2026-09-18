import peggy from 'peggy';
import {describe, expect, it} from 'vitest';

import {readFile} from 'node:fs/promises';

import {parseQuery, SearchError} from './parser.ts';
import type {Diagnostic, Filter, Query} from './types.ts';

function filter(input: string): Filter {
  const result = parseQuery(input);

  if (result?.type !== 'filter') {
    throw new Error('Expected a filter');
  }

  return result;
}

function diagnostics(input: string): Diagnostic[] {
  try {
    parseQuery(input);
    throw new Error('Expected query to fail');
  } catch (error) {
    if (!(error instanceof SearchError)) {
      throw error;
    }

    return error.diagnostics;
  }
}

function shape(query: Query): unknown {
  if (!query) {
    return null;
  }

  switch (query.type) {
    case 'and':
    case 'or':
      return {[query.type]: query.children.map(shape)};
    case 'not':
    case 'group':
      return {[query.type]: shape(query.expression)};
    case 'filter':
      return query.key;
  }
}

describe('search grammar', () => {
  it('keeps the committed parser reproducible from its grammar', async () => {
    const directory = new URL('./', import.meta.url);
    const source = await readFile(new URL('grammar.pegjs', directory), 'utf8');
    const generated = await readFile(new URL('generated.js', directory), 'utf8');

    expect(generated).toBe(
      peggy.generate(source, {output: 'source', format: 'es', cache: true}),
    );
  });

  it('parses an empty query as match-all', () => {
    expect(parseQuery(' \n\t ')).toBeNull();
  });

  it('resolves negation, implicit/explicit AND, and OR precedence', () => {
    expect(shape(parseQuery('a[x] OR b[x] c[x] AND !d[x]'))).toEqual({
      or: ['a', {and: ['b', 'c', {not: 'd'}]}],
    });
    expect(shape(parseQuery('!(a[x] or b[x])\n c[x]'))).toEqual({
      and: [{not: {group: {or: ['a', 'b']}}}, 'c'],
    });
    expect(shape(parseQuery('!!a[x]'))).toEqual({not: {not: 'a'}});
    expect(shape(parseQuery('(a[x] OR b[x]) !c[x]'))).toEqual({
      and: [{group: {or: ['a', 'b']}}, {not: 'c'}],
    });
    expect(shape(parseQuery('a[x] !b[x]'))).toEqual({and: ['a', {not: 'b'}]});
  });

  it.each(['ORange', 'ANDerson', 'NOTable', '"OR"', 'not:visited'])(
    'accepts keyword-like string arguments: %s',
    value => {
      expect(filter(`name[${value}]`).arguments[0].value).toMatchObject({
        value: value.replaceAll('"', ''),
      });
    },
  );

  it('separates tag namespaces from named note constraints', () => {
    const result = filter('tag[attr:laptop-friendly, notes:"*outlet*"]');

    expect(result.arguments).toMatchObject([
      {
        name: null,
        operator: null,
        value: {type: 'string', value: 'attr:laptop-friendly'},
      },
      {name: 'notes', value: {value: '*outlet*', quoted: true, wildcards: [0, 7]}},
    ]);
  });

  it('parses generic filters and functions', () => {
    const result = filter('custom[42, "two", mode:future(nested(@home), count:>=3)]');

    expect(result.arguments).toMatchObject([
      {name: null, value: {value: '42'}},
      {name: null, value: {value: 'two'}},
      {
        name: 'mode',
        value: {
          type: 'function',
          name: 'future',
          arguments: [
            {
              value: {
                name: 'nested',
                arguments: [{value: {type: 'reference', name: 'home'}}],
              },
            },
            {name: 'count', operator: '>=', value: {value: '3'}},
          ],
        },
      },
    ]);
    expect(filter('anything[]').arguments).toEqual([]);
    expect(filter('anything[future()]').arguments[0].value).toMatchObject({
      arguments: [],
    });
  });

  it('supports functions with only named arguments', () => {
    expect(
      filter('custom[future(mode:walk, origin:@home)]').arguments[0].value,
    ).toMatchObject({
      arguments: [
        {name: 'mode'},
        {name: 'origin', value: {type: 'reference', name: 'home'}},
      ],
    });
  });

  it('preserves quoted brackets, escaped characters, and wildcard intent', () => {
    expect(filter('tag["gmaps-list:[NYC] Coffee"]').arguments[0].value).toMatchObject({
      value: 'gmaps-list:[NYC] Coffee',
    });
    expect(filter(String.raw`notes["a\"b\\c\**"]`).arguments[0].value).toMatchObject({
      value: 'a"b\\c**',
      wildcards: [6],
      quoted: true,
    });
    expect(filter('name[="*"]').arguments[0]).toMatchObject({
      operator: '=',
      value: {value: '*'},
    });
    expect(
      filter('location[radius(@"east village", 1mi)]').arguments[0].value,
    ).toMatchObject({
      arguments: [
        {value: {type: 'reference', name: 'east village'}},
        {value: {value: '1mi'}},
      ],
    });
  });

  it('retains source spans through nesting and multiline queries', () => {
    const input = 'tag[type:cafe]\nAND location[radius(@home, 1mi)]';
    const query = parseQuery(input);

    expect(query).toMatchObject({type: 'and', text: input});

    if (query?.type !== 'and') {
      throw new Error('Expected AND');
    }

    const location = query.children[1] as Filter;
    expect(location.location.start).toEqual({offset: 19, line: 2, column: 5});
    expect(
      input.slice(location.location.start.offset, location.location.end.offset),
    ).toBe(location.text);
  });

  it.each([
    'coffee',
    'name[!=coffee]',
    'tag[type:cafe, notes:!=outlets]',
    '"La Cabra"',
    'coffee tag[type:cafe]',
    'tag[type:cafe] coffee',
    'tag[type:cafe] OR coffee',
    'tag[',
    'tag[] trailing[',
    'tag[x,]',
    'tag[x,,y]',
    'location[radius(@home,)]',
    'tag["unclosed]',
    String.raw`notes["bad\q"]`,
    '(tag[x]',
    'tag[x])',
    'tag[x] OR',
    'AND tag[x]',
    'NOT',
    'NOT tag[x]',
    'not tag[x]',
    'tag[x] NOT tag[y]',
    'tag[x] OR NOT tag[y]',
    'tag[x] OR OR tag[y]',
    'tag[x]tag[y]',
    'tag[foo bar]',
    'tag[gmaps-list:[nyc]]',
    'tag["x"] garbage)',
  ])('rejects malformed syntax: %s', input => {
    expect(diagnostics(input)[0].code).toBe('syntax');
  });

  it('reports the syntax error position', () => {
    expect(diagnostics('tag[x]\nOR ]')[0].location.start).toEqual({
      offset: 10,
      line: 2,
      column: 4,
    });
  });
});

describe('query syntax examples', () => {
  it.each([
    'tag[type:cafe] tag[attr:laptop-friendly, notes:"*outlet*"]',
    '(tag[type:cafe] OR tag[type:bakery]) !tag[status:visited]',
    '!has[tag] OR !has[notes]',
    'tag["gmaps-list:[nyc]*"] AND !tag[type:*]',
    'created[>=2026-09-01] updated[<"2026-10-01T12:00:00-04:00"]',
    'location[within("Manhattan, NYC")]',
    'location[radius(point(-73.985, 40.726), 800m)]',
    'location[route(@home, @work, buffer:800ft, mode:walk)]',
    'location[direction(@home, bearing:90deg, spread:60deg, radius:2mi)]',
    'hours[open(now)] hours[openDuring("2026-09-17T15:00:00-04:00", "2026-09-17T17:00:00-04:00")]',
    'saved["date night"] name[="La Cabra"]',
  ])('accepts Places syntax: %s', input => {
    expect(() => parseQuery(input)).not.toThrow();
  });
});
