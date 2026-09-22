import {defineFilter, InvalidValueError} from '@places/common/filter-engine';
import type {SQL} from 'drizzle-orm';

import type {Context} from './context.ts';
import {property} from './data-types/property.ts';

export const has = defineFilter({
  name: 'has',
  description: 'Match places where the selected property is present.',
  examples: [
    {query: 'has[notes]', description: 'Places with a general note.'},
    {query: '!has[notes]', description: 'Places without a general note.'},
    {query: 'has[tag]', description: 'Places with at least one active tag.'},
  ],
  parameters: {
    property: {
      description: 'Property to check, such as notes or tag.',
      type: property,
    },
  },
  validate: ([argument], registry) => {
    const value = argument.value;

    if (value.type === 'string' && !registry.filters.get(value.value)?.presence) {
      return `Presence is not supported for ${value.value}`;
    }
  },
  compile: ({property}, context: Context, registry): SQL => {
    const filter = registry.filters.get(property.value);

    if (!filter?.presence) {
      throw new InvalidValueError(`Presence is not supported for ${property.value}`);
    }

    return filter.presence(context);
  },
});
