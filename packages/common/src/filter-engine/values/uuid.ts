import {z} from 'zod';

import {defineValue, InvalidValueError} from '../definitions.ts';

export const uuid = defineValue<string>()({
  name: 'UUID',
  description: 'A valid UUID.',
  literals: true,
  references: false,
  decode: literal => {
    const parsed = z.uuid().safeParse(literal.value);

    if (!parsed.success) {
      throw new InvalidValueError('Expected a UUID');
    }

    return parsed.data;
  },
});
