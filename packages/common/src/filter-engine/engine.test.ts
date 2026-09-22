import {describe, expect, it, vi} from 'vitest';

import {SearchError, type StringValue} from '../search/index.ts';

import {
  defineFilter,
  defineFilterEngine,
  defineFunction,
  defineValue,
  implementFilterEngine,
  InvalidValueError,
  type ResolvedQuery,
} from './index.ts';

const text = defineValue<StringValue>()({
  name: 'text',
  description: 'Text with wildcard metadata.',
  literals: true,
  references: false,
  decode: value => value,
});
const number = defineValue<number>()({
  name: 'number',
  description: 'A number.',
  literals: true,
  references: false,
  decode: literal => {
    if (!/^-?\d+(?:\.\d+)?$/.test(literal.value)) {
      throw new InvalidValueError('Expected a number');
    }

    return Number(literal.value);
  },
});
const name = defineFilter({
  name: 'name',
  examples: [{query: 'name[cafe]', description: 'Find cafes.'}],
  description: 'Match a name.',
  parameters: {
    value: {description: 'Name value.', type: text, operators: ['=']},
    notes: {description: 'Optional notes.', type: text, optional: true},
  },
  supportsPresence: true,
});
const count = defineFilter({
  name: 'count',
  description: 'Match a count.',
  parameters: {
    value: {description: 'Count value.', type: number, operators: ['>=']},
  },
  supportsPresence: false,
});
const twice = defineFunction({
  name: 'twice',
  examples: [{query: 'count[twice(2)]'}],
  description: 'Double a number.',
  parameters: {value: {description: 'Input.', type: number}},
  returns: number,
  evaluate: ({value}) => value.value * 2,
});
const definition = defineFilterEngine({
  values: {text, number},
  filters: {name, count},
  functions: {twice},
});
const boolean = {
  and: (values: string[]) => `(${values.join(' AND ')})`,
  or: (values: string[]) => `(${values.join(' OR ')})`,
  not: (value: string) => `NOT ${value}`,
  all: () => 'TRUE',
};

function makeEngine() {
  return implementFilterEngine(definition, {
    valueResolvers: {},
    filters: {
      name: {
        compile: ({value, notes}) =>
          `name${value.operator ?? '~'}${value.value.value}${notes ? `/${notes.value.value}` : ''}`,
        presence: () => 'name IS PRESENT',
      },
      count: {
        compile: ({value}) => `count${value.operator ?? '='}${value.value}`,
      },
    },
    boolean,
  });
}

function compile(input: string) {
  const engine = makeEngine();
  return engine.execute(engine.prepare(input), null);
}

describe('filter engine', () => {
  it('describes the shared definition as serializable data', () => {
    const description = makeEngine().describe();

    expect(description.values.map(value => value.name)).toEqual(['text', 'number']);
    expect(description.filters[0]).toMatchObject({
      name: 'name',
      description: 'Match a name.',
      examples: [{query: 'name[cafe]', description: 'Find cafes.'}],
      presence: true,
      parameters: [
        {name: 'value', type: 'text', optional: false, operators: ['=']},
        {name: 'notes', type: 'text', optional: true, operators: []},
      ],
    });
    expect(description.functions[0]).toMatchObject({
      name: 'twice',
      returns: 'number',
    });
    expect(JSON.parse(JSON.stringify(description))).toEqual(description);
  });

  it('composes filters, functions, groups, and negation', async () => {
    await expect(
      compile('name[cafe] OR (count[>=twice(2)] AND !name[bar])'),
    ).resolves.toBe('(name~cafe OR (count>=4 AND NOT name~bar))');
    await expect(compile('name[cafe] count[2]')).resolves.toBe('(name~cafe AND count=2)');
    await expect(compile('')).resolves.toBe('TRUE');
  });

  it('supports optional and named parameters', async () => {
    await expect(compile('name[value:cafe, notes:upstairs]')).resolves.toBe(
      'name~cafe/upstairs',
    );
    expect(() => makeEngine().prepare('count[]')).toThrow('Missing argument: value');
    expect(() => makeEngine().prepare('count[other:3]')).toThrow(
      'Unknown argument: other',
    );
    expect(() => makeEngine().prepare('count[value:3, value:4]')).toThrow(
      'Duplicate argument',
    );
  });

  it('retains operators and wildcard metadata in resolved arguments', async () => {
    const inspect = defineFilter({
      name: 'inspect',
      description: 'Inspect a value.',
      parameters: {value: {description: 'Value.', type: text, operators: ['=']}},
      supportsPresence: false,
    });
    const inspectDefinition = defineFilterEngine({
      values: {text},
      filters: {inspect},
      functions: {},
    });
    const engine = implementFilterEngine(inspectDefinition, {
      valueResolvers: {},
      filters: {inspect: {compile: ({value}) => value}},
      boolean: {
        all: () => null,
        and: values => values[0] ?? null,
        or: values => values[0] ?? null,
        not: value => value,
      },
    });

    await expect(
      engine.execute(engine.prepare('inspect[="a*\\*😀*"]'), null),
    ).resolves.toMatchObject({
      operator: '=',
      value: {value: 'a**😀*', wildcards: [1, 5]},
    });
  });

  it('resolves literals, function results, and references through one resolver', async () => {
    const resolve = vi.fn((value: number, _context: null, operator) =>
      Promise.resolve(value + (operator === '>=' ? 1 : 0)),
    );
    const resolvedNumber = defineValue<number>()({
      name: 'resolved-number',
      description: 'A resolved number.',
      literals: true,
      references: true,
      decode: value => Number(value.value),
    });
    const value = defineFunction({
      name: 'value',
      description: 'Return three.',
      parameters: {},
      returns: resolvedNumber,
      evaluate: () => 3,
    });
    const match = defineFilter({
      name: 'match',
      description: 'Match a value.',
      parameters: {
        value: {description: 'Value.', type: resolvedNumber, operators: ['>=']},
      },
      supportsPresence: false,
    });
    const resolvedDefinition = defineFilterEngine({
      values: {resolvedNumber},
      filters: {match},
      functions: {value},
    });
    const engine = implementFilterEngine(resolvedDefinition, {
      valueResolvers: {
        resolvedNumber: {resolve, resolveReference: () => 5},
      },
      filters: {match: {compile: ({value}) => String(value.value)}},
      boolean,
    });

    for (const [input, output] of [
      ['match[>=1]', '2'],
      ['match[>=value()]', '4'],
      ['match[>=@home]', '6'],
    ]) {
      await expect(engine.execute(engine.prepare(input), null)).resolves.toBe(output);
    }
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it('validates the whole query before starting asynchronous resolution', () => {
    const resolve = vi.fn((value: string) => Promise.resolve(value));
    const external = defineValue<string, string>()({
      name: 'external',
      description: 'External value.',
      literals: true,
      references: false,
      decode: value => value.value,
    });
    const filter = defineFilter({
      name: 'external',
      description: 'External filter.',
      parameters: {value: {description: 'Value.', type: external}},
      supportsPresence: false,
    });
    const externalDefinition = defineFilterEngine({
      values: {external},
      filters: {filter},
      functions: {},
    });
    const engine = implementFilterEngine(externalDefinition, {
      valueResolvers: {external: {resolve}},
      filters: {filter: {compile: ({value}) => value.value}},
      boolean,
    });

    expect(() => engine.prepare('external[valid] unknown[bad]')).toThrow(SearchError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('adds source diagnostics to expected value failures', async () => {
    const point = defineValue<string>()({
      name: 'point',
      description: 'Named point.',
      literals: false,
      references: true,
    });
    const at = defineFilter({
      name: 'at',
      description: 'Match a point.',
      parameters: {value: {description: 'Point.', type: point}},
      supportsPresence: false,
    });
    const pointDefinition = defineFilterEngine({
      values: {point},
      filters: {at},
      functions: {},
    });
    const engine = implementFilterEngine(pointDefinition, {
      valueResolvers: {
        point: {
          resolveReference: name => {
            throw new InvalidValueError(`Unknown location: ${name}`);
          },
        },
      },
      filters: {at: {compile: ({value}) => value.value}},
      boolean,
    });

    await expect(
      engine.execute(engine.prepare('at[@missing]'), null),
    ).rejects.toMatchObject({
      diagnostics: [{code: 'invalid_value', location: {start: {line: 1}}}],
    });
  });

  it('preserves a reference resolver receiver', async () => {
    const point = defineValue<string>()({
      name: 'point',
      description: 'Named point.',
      literals: false,
      references: true,
    });
    const at = defineFilter({
      name: 'at',
      description: 'Match a point.',
      parameters: {value: {description: 'Point.', type: point}},
      supportsPresence: false,
    });
    const pointDefinition = defineFilterEngine({
      values: {point},
      filters: {at},
      functions: {},
    });
    const pointResolver = {
      prefix: 'point',
      resolveReference(name: string) {
        return `${this.prefix}:${name}`;
      },
    };
    const engine = implementFilterEngine(pointDefinition, {
      valueResolvers: {point: pointResolver},
      filters: {at: {compile: ({value}) => value.value}},
      boolean,
    });

    await expect(engine.execute(engine.prepare('at[@home]'), null)).resolves.toBe(
      'point:home',
    );
  });

  it.each([
    ['unknown[x]', 'unknown_filter'],
    ['name[unknown()]', 'unknown_function'],
    ['name[a,b,c]', 'argument_count'],
    ['name[a, other:b]', 'unknown_argument'],
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
      expect((error as SearchError).diagnostics[0]).toMatchObject({code});
    }
  });

  it('binds resolved queries to their engine and resolution context', async () => {
    const engine = makeEngine();
    const other = makeEngine();
    const prepared = engine.prepare('name[x]');

    await expect(other.resolve(prepared, null)).rejects.toThrow('not prepared');
    // @ts-expect-error Resolved queries are opaque engine tokens.
    const fabricated: ResolvedQuery = {phase: 'resolved', query: null};
    expect(() => other.compile(fabricated)).toThrow('not resolved');
  });
});
