import {defineFilter, InvalidValueError, valueType} from '@places/common/filter-engine';
import type {StringValue} from '@places/common/search';
import type {SQL} from 'drizzle-orm';

import type {Context} from './context.ts';

export const property = valueType({
  name: 'property with presence support',
  description: 'Name of a registered filter with presence support.',
  decode: (value: StringValue) => value.value,
});

export const has = defineFilter({
  name: 'has',
  description: 'Match places where the selected property is present.',
  examples: [
    {query: 'has[notes]', description: 'Places with a general note.'},
    {query: '!has[notes]', description: 'Places without a general note.'},
    {query: 'has[tag]', description: 'Places with at least one tag.'},
  ],
  positional: [
    {
      name: 'property',
      description: 'Property to check, such as notes or tag.',
      type: property,
    },
  ] as const,
  validate: ([argument], registry) => {
    const value = argument.value;

    if (value.type === 'string' && !registry.filters.get(value.value)?.presence) {
      return `Presence is not supported for ${value.value}`;
    }
  },
  compile: ({positional: [argument]}, context: Context, registry): SQL => {
    const filter = registry.filters.get(argument.value);

    if (!filter?.presence) {
      throw new InvalidValueError(`Presence is not supported for ${argument.value}`);
    }

    return filter.presence(context);
  },
});
