import {InvalidValueError, valueType} from '@places/common/filter-engine';
import type {StringValue} from '@places/common/search';
import {z} from 'zod';

export const uuid = valueType({
  name: 'UUID',
  description: 'A valid UUID.',
  decode: (value: StringValue) => {
    const parsed = z.uuid().safeParse(value.value);

    if (!parsed.success) {
      throw new InvalidValueError('Expected a UUID');
    }

    return parsed.data;
  },
});
