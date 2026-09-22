import {valueType} from '@places/common/filter-engine';
import type {StringValue} from '@places/common/search';

export const textLiteral = valueType({
  name: 'text literal',
  description: 'An exact string value. Stars remain literal characters.',
  decode: (value: StringValue) => value.value,
});
