import type {StringValue} from '../../search/types.ts';
import {defineValue, InvalidValueError} from '../definitions.ts';

export const tagName = defineValue<StringValue>()({
  name: 'tag name',
  description:
    'Tag names are normalized by trimming and lowercasing. Namespaced tags use namespace.tag. Matches the complete stored name; use * for patterns. Unknown exact names produce an error, including under !. = treats stars literally.',
  literals: true,
  references: false,
  decode: literal => {
    if (!literal.value.trim()) {
      throw new InvalidValueError('Expected a nonempty tag name');
    }

    return literal;
  },
});
