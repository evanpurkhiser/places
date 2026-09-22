import {defineFunction} from '@places/common/filter-engine';

import {geographicPoint} from '../data-types/geographic-point.ts';
import {latitude} from '../data-types/latitude.ts';
import {longitude} from '../data-types/longitude.ts';

export const point = defineFunction({
  name: 'point',
  description: 'A geographic point in longitude, latitude order (WGS84).',
  parameters: {
    longitude: {description: 'Longitude in degrees.', type: longitude},
    latitude: {description: 'Latitude in degrees.', type: latitude},
  },
  returns: geographicPoint,
  resolve: ({longitude, latitude}) => ({
    longitude: longitude.value,
    latitude: latitude.value,
  }),
});
