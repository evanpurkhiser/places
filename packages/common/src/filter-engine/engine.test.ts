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
const boolean = {
  and: (values: string[]) => `(${values.join(' AND ')})`,
  or: (values: string[]) => `(${values.join(' OR ')})`,
  not: (value: string) => `NOT ${value}`,
  all: () => 'TRUE',
};
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
    boolean,
  });
}

async function compile(input: string) {
  const engine = makeEngine();
  return engine.compile(await engine.resolve(engine.prepare(input), null), null);
}

describe('filter engine', () => {
  it('dispatches filters and composes precedence, groups and negation', async () => {
    expect(await compile('name[cafe] OR (count[>=twice(2)] AND !name[bar])')).toBe(
      '(name~cafe OR (count>=4 AND NOT name~bar))',
    );
    expect(await compile('name[cafe] count[2]')).toBe('(name~cafe AND count=2)');
    expect(await compile('')).toBe('TRUE');
  });

  it('infers function argument and return types and supports nesting', async () => {
    expect(await compile('count[twice(twice(3))]')).toBe('count=12');
    expect(() => makeEngine().prepare('name[twice(3)]')).toThrow(
      'returns number; expected text',
    );
  });

  it('retains operators and source wildcard metadata', async () => {
    const engine = createFilterEngine({
      types: [text],
      boolean: {
        and: (values: unknown[]) => values,
        or: (values: unknown[]) => values,
        not: (value: unknown) => value,
        all: () => null,
      },
      filters: [
        defineFilter({
          name: 'inspect',
          positional: [{name: 'value', type: text, operators: ['=']}],
          compile: ({positional: [value]}, _ctx: null) => value,
        }),
      ],
    });
    const input = 'inspect[="a*\\*😀*"]';
    const result = engine.compile(
      await engine.resolve(engine.prepare(input), null),
      null,
    );
    expect(result).toMatchObject({
      operator: '=',
      value: {value: 'a**😀*', wildcards: [1, 5]},
      source: {text: '="a*\\*😀*"'},
    });
  });

  it('supports optional named parameters', async () => {
    expect(await compile('name[cafe, notes:upstairs]')).toBe('name~cafe/upstairs');
    expect(await compile('name[cafe]')).toBe('name~cafe');
  });

  it('validates named function parameters, ordering, and cross-argument constraints', async () => {
    const add = defineFunction({
      name: 'add',
      positional: [{name: 'value', type: number, optional: true}],
      named: {amount: {type: number}},
      returns: number,
      resolve: ({positional: [value], named}, _context: null) =>
        (value?.value ?? 0) + named.amount.value,
      validate: args =>
        args.length > 1 ? 'Only one argument for this example' : undefined,
    });
    const engine = createFilterEngine({
      types: [number],
      functions: [add],
      filters: [count],
      boolean,
    });
    expect(
      engine.compile(
        await engine.resolve(engine.prepare('count[add(amount:3)]'), null),
        null,
      ),
    ).toBe('count=3');
    expect(() => engine.prepare('count[add()]')).toThrow('Missing argument: amount');
    expect(() => engine.prepare('count[add(amount:3, 2)]')).toThrow(
      'Positional arguments must precede',
    );
    expect(() => engine.prepare('count[add(2, amount:3)]')).toThrow('Only one argument');
    expect(() => engine.prepare('count[add(constructor:3)]')).toThrow(
      'Unknown argument: constructor',
    );
  });

  it('resolves all value sources with their consuming argument metadata', async () => {
    const resolve = vi.fn(
      (value: number, _context: null, source: {operator: string | null}) =>
        value + (source.operator === '>=' ? 1 : 0),
    );
    const type = valueType<number, null>({
      name: 'resolved-number',
      decode: value => Number(value.value),
      resolve,
      resolveReference: () => 5,
    });
    const value = defineFunction({
      name: 'value',
      positional: [],
      returns: type,
      resolve: (_args, _context: null) => 3,
    });
    const filter = defineFilter({
      name: 'value',
      positional: [{name: 'value', type, operators: ['>=']}],
      compile: ({positional: [argument]}, _ctx: null) => `${argument.value}`,
    });
    const engine = createFilterEngine({
      types: [type],
      functions: [value],
      filters: [filter],
      boolean,
    });
    for (const [input, output] of [
      ['value[>=1]', '2'],
      ['value[>=value()]', '4'],
      ['value[>=@home]', '6'],
    ]) {
      expect(
        engine.compile(await engine.resolve(engine.prepare(input), null), null),
      ).toBe(output);
    }
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it('keeps compiler programming failures distinct from invalid input', async () => {
    const error = new Error('Invalid internal query');
    const filter = defineFilter({
      name: 'broken',
      positional: [],
      compile: (_args, _ctx: null): string => {
        throw error;
      },
    });
    const engine = createFilterEngine({types: [], filters: [filter], boolean});
    const resolved = await engine.resolve(engine.prepare('broken[]'), null);
    expect(() => engine.compile(resolved, null)).toThrow(error);
    try {
      engine.compile(resolved, null);
    } catch (caught) {
      expect(caught).toBe(error);
    }
  });

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
      boolean,
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
    expect(() => createFilterEngine({types: [text, text], filters: [], boolean})).toThrow(
      'Duplicate',
    );
    expect(() => createFilterEngine({types: [], filters: [name], boolean})).toThrow(
      'Unregistered type',
    );
    expect(() =>
      createFilterEngine({types: [text], filters: [name, name], boolean}),
    ).toThrow('Duplicate');
    expect(() =>
      createFilterEngine({
        types: [number],
        filters: [],
        functions: [twice, twice],
        boolean,
      }),
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
      boolean,
    });
    expect(() => engine.prepare('external[valid] unknown[bad]')).toThrow(SearchError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('resolves named references and isolates unexpected failures', async () => {
    const providerFailure = new Error('Provider unavailable');
    const point = valueType<string>({
      name: 'point',
      resolveReference: name => {
        if (name === 'missing') {
          throw new InvalidValueError('Unknown location');
        }

        if (name === 'broken') {
          throw providerFailure;
        }

        return `point:${name}`;
      },
    });
    const engine = createFilterEngine({
      types: [point],
      filters: [
        defineFilter({
          name: 'at',
          positional: [{name: 'value', type: point}],
          compile: ({positional: [value]}, _ctx: null) => value.value,
        }),
      ],
      boolean,
    });
    expect(
      engine.compile(await engine.resolve(engine.prepare('at[@home]'), null), null),
    ).toBe('point:home');
    await expect(
      engine.resolve(engine.prepare('at[@missing]'), null),
    ).rejects.toBeInstanceOf(SearchError);
    await expect(engine.resolve(engine.prepare('at[@broken]'), null)).rejects.toBe(
      providerFailure,
    );
    expect(() => engine.prepare('at[home]')).toThrow('Expected a function or reference');
  });

  it('rejects plans from another engine', async () => {
    const engine = makeEngine();
    const other = makeEngine();
    await expect(other.resolve(engine.prepare('name[x]'), null)).rejects.toThrow(
      'not prepared',
    );
    expect(() => other.compile({phase: 'resolved', query: null}, null)).toThrow(
      'not resolved',
    );
  });

  it('rejects bare text and unregistered filters', () => {
    const engine = createFilterEngine({types: [text], filters: [name], boolean});
    expect(() => engine.prepare('hello')).toThrow(SearchError);
    expect(() => engine.prepare('constructor[x]')).toThrow('Unknown filter');
  });
});
