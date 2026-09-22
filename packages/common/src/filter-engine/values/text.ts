import type {StringValue} from '../../search/types.ts';
import {defineValue} from '../definitions.ts';

export const text = defineValue<StringValue>()({
  name: 'text',
  description:
    'Matches anywhere within the field, ignoring case. Use = to match the complete literal value. Unescaped * matches zero or more characters; SQL % and _ are literal.',
  literals: true,
  references: false,
  decode: literal => literal,
});
