import {describe, expect, it} from 'vitest';

import {has} from './filters/has.ts';
import {defineFilter, defineFilterEngine, implementFilterEngine} from './index.ts';
import {property} from './values/property.ts';

const value = defineFilter({
  name: 'value',
  description: 'Value with presence support.',
  parameters: {},
  supportsPresence: true,
});
const definition = defineFilterEngine({
  values: {property},
  filters: {has, value},
  functions: {},
});
const boolean = {
  all: () => true,
  and: (values: boolean[]) => values.every(Boolean),
  or: (values: boolean[]) => values.some(Boolean),
  not: (item: boolean) => !item,
};

function engine(invert: boolean) {
  const valueCompiler = {
    invert,
    compile: (_args: Record<never, never>, context: boolean) => context,
    presence(context: boolean) {
      return this.invert ? !context : context;
    },
  };

  return implementFilterEngine<typeof definition, boolean, boolean>(definition, {
    valueResolvers: {},
    filters: {
      has: {
        compile: ({property}, context, presence) =>
          presence.get(property.value)!(context),
      },
      value: valueCompiler,
    },
    boolean,
  });
}

describe('presence registry', () => {
  it('uses each engine implementation for validation and compilation', async () => {
    const first = engine(false);
    const second = engine(true);

    expect(() => first.prepare('has[missing]')).toThrow(
      'Presence is not supported for missing',
    );
    await expect(first.execute(first.prepare('has[value]'), true)).resolves.toBe(true);
    await expect(second.execute(second.prepare('has[value]'), true)).resolves.toBe(false);
  });
});
