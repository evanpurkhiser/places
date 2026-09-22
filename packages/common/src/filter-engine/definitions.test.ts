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
      parameters: {
        value: {description: 'Argument value.', type: text},
        required: {description: 'Argument value.', type: number},
        optional: {description: 'Argument value.', type: text, optional: true},
      },
      compile: ({value, required, optional}, _context: null) => {
        expectTypeOf(value.value).toEqualTypeOf<StringValue>();
        expectTypeOf(required.value).toEqualTypeOf<number>();
        expectTypeOf(optional).toEqualTypeOf<ResolvedArgument<StringValue> | undefined>();
        return '';
      },
    });
    defineFunction({
      name: 'invalid',
      description: 'Invalid test registration.',
      parameters: {},
      returns: number,
      // @ts-expect-error A function must return its declared semantic value type.
      resolve: (_args, _context: null) => 'wrong',
    });
  });
});
