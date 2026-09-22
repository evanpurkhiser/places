import {describe, expectTypeOf, it} from 'vitest';

import type {StringValue} from '../search/index.ts';

import {
  defineFilter,
  defineFilterEngine,
  defineFunction,
  defineValue,
  type FilterEngineImplementation,
  type ResolvedArgument,
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
  decode: literal => Number(literal.value),
});
const resolved = defineValue<number, string>()({
  name: 'resolved',
  description: 'A server-resolved number.',
  literals: true,
  references: false,
  decode: literal => literal.value,
});
const reference = defineValue<number>()({
  name: 'reference',
  description: 'A referenced number.',
  literals: false,
  references: true,
});

describe('filter engine definitions', () => {
  it('preserves definition argument and return types', () => {
    const filter = defineFilter({
      name: 'typed',
      description: 'Typed test definition.',
      parameters: {
        value: {description: 'Argument value.', type: text},
        required: {description: 'Argument value.', type: number},
        optional: {description: 'Argument value.', type: text, optional: true},
      },
      supportsPresence: false,
    });
    const definition = defineFilterEngine({
      values: {text, number},
      filters: {filter},
      functions: {},
    });
    const implementation = {
      valueResolvers: {},
      filters: {
        filter: {
          compile: ({value, required, optional}) => {
            expectTypeOf(value.value).toEqualTypeOf<StringValue>();
            expectTypeOf(required.value).toEqualTypeOf<number>();
            expectTypeOf(optional).toEqualTypeOf<
              ResolvedArgument<StringValue> | undefined
            >();
            return true;
          },
        },
      },
      boolean: {
        all: () => true,
        and: values => values.every(Boolean),
        or: values => values.some(Boolean),
        not: value => !value,
      },
    } satisfies FilterEngineImplementation<typeof definition, boolean, null>;

    expectTypeOf(implementation.filters.filter.compile).toBeFunction();

    defineFunction({
      name: 'invalid',
      description: 'Invalid test definition.',
      parameters: {},
      returns: number,
      // @ts-expect-error A function returns its declared semantic value type.
      evaluate: () => 'wrong',
    });
  });

  it('requires server handlers implied by common capabilities', () => {
    const present = defineFilter({
      name: 'present',
      description: 'Presence check.',
      parameters: {},
      supportsPresence: true,
    });
    const definition = defineFilterEngine({
      values: {resolved, reference},
      filters: {present},
      functions: {},
    });
    const boolean = {
      all: () => true,
      and: (values: boolean[]) => values.every(Boolean),
      or: (values: boolean[]) => values.some(Boolean),
      not: (value: boolean) => !value,
    };

    const verifyTypes = () => {
      const missingResolvers: FilterEngineImplementation<
        typeof definition,
        boolean,
        null
      > = {
        // @ts-expect-error Resolved literals and references require value resolvers.
        valueResolvers: {},
        filters: {present: {compile: () => true, presence: () => true}},
        boolean,
      };

      const resolvers = {
        resolved: {resolve: (value: string) => Number(value)},
        reference: {resolveReference: () => 1},
      };
      const missingPresence: FilterEngineImplementation<
        typeof definition,
        boolean,
        null
      > = {
        valueResolvers: resolvers,
        filters: {
          // @ts-expect-error Presence support requires a presence compiler.
          present: {compile: () => true},
        },
        boolean,
      };

      return [missingResolvers, missingPresence];
    };

    expectTypeOf(verifyTypes).toBeFunction();
  });
});
