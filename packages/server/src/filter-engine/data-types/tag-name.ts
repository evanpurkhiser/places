import {InvalidValueError, valueType} from '@places/common/filter-engine';
import type {Argument, StringValue} from '@places/common/search';

import type {Context} from '../context.ts';

export const tagName = valueType<StringValue, Context>({
  name: 'tag name',
  description:
    'Tag names are arbitrary labels, normalized by trimming and lowercasing. Colons are ordinary characters. Matches the complete tag name; use * for patterns. Unknown exact names produce an error, including under !. = treats stars literally.',
  decode: (value: StringValue) => {
    if (!value.value.trim()) {
      throw new InvalidValueError('Expected a nonempty tag name');
    }

    return value;
  },
  resolve: async (value, context, argument: Argument) => {
    const exact = argument.operator !== null || value.wildcards.length === 0;
    const name = value.value.trim().toLowerCase();

    if (exact && !(await context.tagExists(name))) {
      throw new InvalidValueError(`Unknown tag: ${name}`);
    }

    return value;
  },
});
