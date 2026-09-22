import {defineValue} from '../definitions.ts';

import {decodeCoordinate} from './helpers/coordinate.ts';

export const latitude = defineValue<number>()({
  name: 'latitude',
  description: 'Decimal degrees between -90 and 90, inclusive.',
  literals: true,
  references: false,
  decode: decodeCoordinate('latitude', 90),
});
