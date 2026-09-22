import {defineValue} from '../definitions.ts';

export const textLiteral = defineValue<string>()({
  name: 'text literal',
  description: 'An exact string value. Stars remain literal characters.',
  literals: true,
  references: false,
  decode: literal => literal.value,
});
