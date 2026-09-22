import {defineValue} from '../definitions.ts';

import {decodeCoordinate} from './helpers/coordinate.ts';

export const longitude = defineValue<number>()({
  name: 'longitude',
  description: 'Decimal degrees between -180 and 180, inclusive.',
  literals: true,
  references: false,
  decode: decodeCoordinate('longitude', 180),
});
