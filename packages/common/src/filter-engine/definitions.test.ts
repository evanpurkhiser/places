import {describe, expectTypeOf, it} from 'vitest';

import type {StringValue} from '../search/index.ts';

import {defineFilter, defineFunction, type ResolvedArgument, valueType} from './index.ts';

const text = valueType<StringValue>({
  name: 'text',
  description: 'Text with wildcard metadata.',
  decode: value => value,
});
const number = valueType<number>({
  name: 'number',
  description: 'Number test registration.',
  decode: literal => Number(literal.value),
});

describe('registration definitions', () => {
  it('preserves registration argument types at compile time', () => {
    defineFilter({
      name: 'typed',
      description: 'Typed test registration.',
      positional: [
        {name: 'value', description: 'Argument value.', type: text},
        {name: 'value', description: 'Argument value.', type: number, optional: true},
      ],
      named: {
        required: {description: 'Argument value.', type: number},
        optional: {description: 'Argument value.', type: text, optional: true},
      },
      compile: ({positional, named}, _context: null) => {
        expectTypeOf(positional[0].value).toEqualTypeOf<StringValue>();
        expectTypeOf(positional[1]).toEqualTypeOf<ResolvedArgument<number> | undefined>();
        expectTypeOf(named.required.value).toEqualTypeOf<number>();
        expectTypeOf(named.optional).toEqualTypeOf<
          ResolvedArgument<StringValue> | undefined
        >();
        return '';
      },
    });
    defineFunction({
      name: 'invalid',
      description: 'Invalid test registration.',
      positional: [],
      returns: number,
      // @ts-expect-error A function must return its declared semantic value type.
      resolve: (_args, _context: null) => 'wrong',
    });
  });
});
