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
  description: 'Text with wildcard metadata.',
  decode: value => value,
});
const number = valueType<number>({
  name: 'number',
  description: 'Number test registration.',
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
  examples: [
    {query: 'name[cafe]', description: 'Find cafes.'},
    {query: 'name[cafe, notes:upstairs]'},
  ],
  description: 'Name test registration.',
  positional: [
    {name: 'value', description: 'Argument value.', type: text, operators: ['=']},
  ],
  named: {notes: {description: 'Argument value.', type: text, optional: true}},
  compile: ({positional: [value], named}, _context: null) =>
    `name${value.operator ?? '~'}${value.value.value}${named.notes ? `/${named.notes.value.value}` : ''}`,
  presence: (_context: null) => 'name IS PRESENT',
});
const count = defineFilter({
  name: 'count',
  description: 'Count test registration.',
  positional: [
    {name: 'value', description: 'Argument value.', type: number, operators: ['>=']},
  ],
  compile: ({positional: [value]}, _context: null) =>
    `count${value.operator ?? '='}${value.value}`,
});
const twice = defineFunction({
  name: 'twice',
  examples: [{query: 'count[twice(2)]'}],
  description: 'Twice test registration.',
  positional: [{name: 'value', description: 'Argument value.', type: number}],
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
  it('describes registered signatures and capabilities as serializable data', () => {
    const engine = makeEngine();
    const description = engine.describe();

    expect(description.types).toEqual([
      {name: 'text', description: text.description, literals: true, references: false},
      {
        name: 'number',
        description: number.description,
        literals: true,
        references: false,
      },
    ]);
    expect(description.filters[0]).toEqual({
      name: 'name',
      description: name.description,
      examples: [
        {query: 'name[cafe]', description: 'Find cafes.'},
        {query: 'name[cafe, notes:upstairs]'},
      ],
      presence: true,
      positional: [
        {
          name: 'value',
          description: 'Argument value.',
          type: 'text',
          optional: false,
          operators: ['='],
        },
      ],
      named: [
        {
          name: 'notes',
          description: 'Argument value.',
          type: 'text',
          optional: true,
          operators: [],
        },
      ],
    });
    expect(description.filters[1]).toMatchObject({presence: false, examples: []});
    expect(description.functions).toEqual([
      {
        name: 'twice',
        description: twice.description,
        examples: [{query: 'count[twice(2)]'}],
        returns: 'number',
        positional: [
          {
            name: 'value',
            description: 'Argument value.',
            type: 'number',
            optional: false,
            operators: [],
          },
        ],
        named: [],
      },
    ]);
    expect(JSON.parse(JSON.stringify(description))).toEqual(description);

    for (const registration of [...description.filters, ...description.functions]) {
      for (const example of registration.examples) {
        expect(() => engine.prepare(example.query)).not.toThrow();
      }
    }
  });

  it('describes reference-only types without invoking their handlers', () => {
    const resolveReference = vi.fn(() => 'home');
    const location = valueType({
      name: 'location',
      description: 'A named location.',
      resolveReference,
    });
    const engine = createFilterEngine({types: [location], filters: [], boolean});
    expect(engine.describe()).toEqual({
      types: [
        {
          name: 'location',
          description: 'A named location.',
          literals: false,
          references: true,
        },
      ],
      filters: [],
      functions: [],
    });
    expect(resolveReference).not.toHaveBeenCalled();
  });

  it('returns documentation snapshots independent of registration state', () => {
    const engine = makeEngine();
    const description = engine.describe();
    description.filters[0]!.examples.push({query: 'invalid example'});
    description.filters[0]!.positional[0]!.operators.push('>');
    description.types[0]!.name = 'changed';
    expect(engine.describe()).toEqual(makeEngine().describe());
    expect(() => engine.prepare('name[>x]')).toThrow('Operator > is not allowed');
  });

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
          description: 'Inspect test registration.',
          positional: [
            {name: 'value', description: 'Argument value.', type: text, operators: ['=']},
          ],
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

  it('binds named-only filters and positional values in declared order', async () => {
    const difference = defineFunction({
      name: 'difference',
      description: 'Subtract the second value from the first.',
      positional: [
        {name: 'first', description: 'First value.', type: number},
        {name: 'second', description: 'Second value.', type: number},
      ],
      returns: number,
      resolve: ({positional: [first, second]}, _context: null) =>
        first.value - second.value,
    });
    const named = defineFilter({
      name: 'named',
      description: 'A filter with only named parameters.',
      positional: [],
      named: {value: {description: 'Value to match.', type: number}},
      compile: ({named: {value}}, _context: null) => `value=${value.value}`,
    });
    const engine = createFilterEngine({
      types: [number],
      functions: [difference],
      filters: [named, count],
      boolean,
    });
    const result = engine.compile(
      await engine.resolve(engine.prepare('named[value:difference(8, 3)]'), null),
      null,
    );

    expect(result).toBe('value=5');
    expect(() => engine.prepare('named[]')).toThrow('Missing argument: value');
    expect(() => engine.prepare('named[other:3]')).toThrow('Unknown argument: other');
    expect(() => engine.prepare('named[value:3, value:4]')).toThrow('Duplicate argument');
    expect(() => engine.prepare('count[value:3]')).toThrow('positional arguments');
  });

  it('validates named function parameters, ordering, and cross-argument constraints', async () => {
    const add = defineFunction({
      name: 'add',
      description: 'Add test registration.',
      positional: [
        {name: 'value', description: 'Argument value.', type: number, optional: true},
      ],
      named: {amount: {description: 'Argument value.', type: number}},
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
      description: 'Resolved-number test registration.',
      decode: value => Number(value.value),
      resolve,
      resolveReference: () => 5,
    });
    const value = defineFunction({
      name: 'value',
      description: 'Value test registration.',
      positional: [],
      returns: type,
      resolve: (_args, _context: null) => 3,
    });
    const filter = defineFilter({
      name: 'value',
      description: 'Value test registration.',
      positional: [
        {name: 'value', description: 'Argument value.', type, operators: ['>=']},
      ],
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
      description: 'Broken test registration.',
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
      description: 'Add numbers.',
      positional: [
        {
          name: 'value',
          description: 'Optional base value.',
          type: number,
          optional: true,
        },
      ],
      named: {amount: {description: 'Amount to add.', type: number}},
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
    ['name[notes:b, a]', 'argument_order'],
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
      description: 'External test registration.',
      decode: value => value.value,
      resolve,
    });
    const engine = createFilterEngine({
      types: [external],
      filters: [
        defineFilter({
          name: 'external',
          description: 'External test registration.',
          positional: [{name: 'value', description: 'Argument value.', type: external}],
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
      description: 'Point test registration.',
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
          description: 'At test registration.',
          positional: [{name: 'value', description: 'Argument value.', type: point}],
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
