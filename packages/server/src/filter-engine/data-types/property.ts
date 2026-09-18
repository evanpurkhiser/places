import {valueType} from '@places/common/filter-engine';
import type {StringValue} from '@places/common/search';

export const property = valueType({
  name: 'property with presence support',
  description: 'Name of a registered filter with presence support.',
  decode: (value: StringValue) => value.value,
});
