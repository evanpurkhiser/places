import {defineValue} from '../definitions.ts';

export const property = defineValue<string>()({
  name: 'property with presence support',
  description: 'Name of a registered filter with presence support.',
  literals: true,
  references: false,
  decode: literal => literal.value,
});
