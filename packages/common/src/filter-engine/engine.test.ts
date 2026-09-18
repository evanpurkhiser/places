import {describe, expect, it, vi} from 'vitest';

import {SearchError, type StringValue} from '../search/index.ts';

import {
  createFilterEngine,
  defineFilter,
  defineFunction,
  InvalidValueError,
  valueType,
} from './index.ts';

const text = valueType<StringValue>({
  name: 'text',
  decode: value => value,
});
const number = valueType<number>({
  name: 'number',
  decode: literal => {
    if (!/^-?\d+(?:\.\d+)?$/.test(literal.value)) {
      throw new InvalidValueError('Expected a number');
    }

    return Number(literal.value);
  },
});
const name = defineFilter({
  name: 'name',
  positional: [{name: 'value', type: text, operators: ['=']}],
  named: {notes: {type: text, optional: true}},
  compile: ({positional: [value], named}, _context: null) =>
    `name${value.operator ?? '~'}${value.value.value}${named.notes ? `/${named.notes.value.value}` : ''}`,
});
const count = defineFilter({
  name: 'count',
  positional: [{name: 'value', type: number, operators: ['>=']}],
  compile: ({positional: [value]}, _context: null) =>
    `count${value.operator ?? '='}${value.value}`,
});
const twice = defineFunction({
  name: 'twice',
  positional: [{name: 'value', type: number}],
  returns: number,
  resolve: ({positional: [value]}, _context: null) => value.value * 2,
});

function makeEngine() {
  return createFilterEngine({
    types: [text, number],
    filters: [name, count],
    functions: [twice],
  });
}

describe('filter engine', () => {
  it('prepares nested calls and Boolean groups without executing handlers', () => {
    const engine = makeEngine();
    expect(
      engine.prepare('name[cafe] OR (count[>=twice(twice(2))] !name[bar])').phase,
    ).toBe('prepared');
    expect(engine.prepare('').query).toBeNull();
    expect(() => engine.prepare('name[twice(2)]')).toThrow(
      'returns number; expected text',
    );
  });

  it('validates named arguments and cross-argument constraints', () => {
    const add = defineFunction({
      name: 'add',
      positional: [{name: 'value', type: number, optional: true}],
      named: {amount: {type: number}},
      returns: number,
      resolve: ({positional: [value], named}, _context: null) =>
        (value?.value ?? 0) + named.amount.value,
      validate: args => (args.length > 1 ? 'Only one argument' : undefined),
    });
    const engine = createFilterEngine({
      types: [number],
      functions: [add],
      filters: [count],
    });
    expect(() => engine.prepare('count[add(amount:3)]')).not.toThrow();
    expect(() => engine.prepare('count[add()]')).toThrow('Missing argument: amount');
    expect(() => engine.prepare('count[add(amount:3, 2)]')).toThrow(
      'Positional arguments must precede',
    );
    expect(() => engine.prepare('count[add(2, amount:3)]')).toThrow('Only one argument');
    expect(() => engine.prepare('count[add(constructor:3)]')).toThrow(
      'Unknown argument: constructor',
    );
  });

  it('rejects duplicate registrations and unregistered value types', () => {
    expect(() => createFilterEngine({types: [text, text], filters: []})).toThrow(
      'Duplicate',
    );
    expect(() => createFilterEngine({types: [], filters: [name]})).toThrow(
      'Unregistered type',
    );
    expect(() => createFilterEngine({types: [text], filters: [name, name]})).toThrow(
      'Duplicate',
    );
    expect(() =>
      createFilterEngine({types: [number], filters: [], functions: [twice, twice]}),
    ).toThrow('Duplicate');
  });

  it.each([
    ['unknown[x]', 'unknown_filter'],
    ['name[unknown()]', 'unknown_function'],
    ['name[]', 'argument_count'],
    ['name[a,b]', 'argument_count'],
    ['name[a, other:b]', 'unknown_argument'],
    ['name[a, notes:b, notes:c]', 'duplicate_argument'],
    ['count[>=oops]', 'invalid_value'],
    ['name[>x]', 'invalid_operator'],
    ['name[@home]', 'invalid_value'],
  ])('rejects %s with source diagnostics', (input, code) => {
    try {
      makeEngine().prepare(input);
      expect.fail('Expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(SearchError);
      expect((error as SearchError).diagnostics[0]).toMatchObject({
        code,
        location: {start: {line: 1}},
      });
    }
  });

  it('validates the entire query before any asynchronous resolution', () => {
    const resolve = vi.fn((value: string) => Promise.resolve(value));
    const external = valueType<string>({
      name: 'external',
      decode: value => value.value,
      resolve,
    });
    const engine = createFilterEngine({
      types: [external],
      filters: [
        defineFilter({
          name: 'external',
          positional: [{name: 'value', type: external}],
          compile: ({positional: [value]}, _ctx: null) => value.value,
        }),
      ],
    });
    expect(() => engine.prepare('external[valid] unknown[bad]')).toThrow(SearchError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects bare text and unregistered filters', () => {
    const engine = createFilterEngine({types: [text], filters: [name]});
    expect(() => engine.prepare('hello')).toThrow(SearchError);
    expect(() => engine.prepare('constructor[x]')).toThrow('Unknown filter');
  });
});
