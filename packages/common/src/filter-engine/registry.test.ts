import {describe, expect, it} from 'vitest';

import {createFilterEngine, defineFilter, defineFunction, valueType} from './index.ts';

const text = valueType({
  name: 'text',
  description: 'Text value.',
  decode: value => value.value,
});
const boolean = {
  all: () => true,
  and: (values: boolean[]) => values.every(Boolean),
  or: (values: boolean[]) => values.some(Boolean),
  not: (value: boolean) => !value,
};
const present = defineFilter({
  name: 'present',
  description: 'Check property presence.',
  positional: [{name: 'property', description: 'Property to check.', type: text}],
  validate: ([argument], registry) =>
    argument?.value.type === 'string' &&
    !registry.filters.get(argument.value.value)?.presence
      ? 'Property does not support presence'
      : undefined,
  compile: ({positional: [argument]}, context: boolean, registry) =>
    registry.filters.get(argument.value)!.presence!(context),
});
const property = defineFunction({
  name: 'property',
  description: 'Select the value property.',
  positional: [],
  returns: text,
  validate: (_args, registry) =>
    registry.filters.has('value') ? undefined : 'Missing value filter',
  resolve: (_args, _context: boolean) => 'value',
});
function engine(invert: boolean) {
  return createFilterEngine({
    types: [text],
    filters: [
      present,
      defineFilter({
        name: 'value',
        description: 'Value with presence support.',
        positional: [],
        compile: (_args, context: boolean) => context,
        presence: (context: boolean) => (invert ? !context : context),
      }),
    ],
    functions: [property],
    boolean,
  });
}

describe('registration registry access', () => {
  it('uses each invoking engine registry for validation and compilation', async () => {
    const first = engine(false);
    const second = engine(true);
    expect(() => first.prepare('present[missing]')).toThrow(
      'Property does not support presence',
    );
    expect(
      first.compile(await first.resolve(first.prepare('present[value]'), true), true),
    ).toBe(true);
    expect(
      second.compile(await second.resolve(second.prepare('present[value]'), true), true),
    ).toBe(false);
  });

  it('supplies the invoking registry to function validation', () => {
    expect(() => engine(false).prepare('present[property()]')).not.toThrow();
    const missing = createFilterEngine({
      types: [text],
      filters: [present],
      functions: [property],
      boolean,
    });
    expect(() => missing.prepare('present[property()]')).toThrow('Missing value filter');
  });
});
