import {valueType} from '@places/common/filter-engine';
import type {StringValue} from '@places/common/search';

export const text = valueType({
  name: 'text',
  description:
    'Matches anywhere within the field, ignoring case. Use = to match the complete literal value. Unescaped * matches zero or more characters; SQL % and _ are literal.',
  decode: (value: StringValue) => value,
});
export const equality = ['='] as const;
