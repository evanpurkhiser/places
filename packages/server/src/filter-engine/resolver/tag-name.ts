import {InvalidValueError, type ValueResolverFor} from '@places/common/filter-engine';
import type {tagName} from '@places/common/filter-engine/values/tag-name';

import type {Context} from '../context.ts';

export const tagNameResolver = {
  resolve: async (value, context: Context, operator) => {
    const exact = operator !== null || value.wildcards.length === 0;
    const name = value.value.trim().toLowerCase();

    if (exact && !(await context.tagExists(name))) {
      throw new InvalidValueError(`Unknown tag: ${name}`);
    }

    return value;
  },
} satisfies ValueResolverFor<typeof tagName, Context>;
