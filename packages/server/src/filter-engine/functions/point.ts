import {defineFunction} from '@places/common/filter-engine';

import {geographicPoint} from '../data-types/geographic-point.ts';
import {latitude} from '../data-types/latitude.ts';
import {longitude} from '../data-types/longitude.ts';

export const point = defineFunction({
  name: 'point',
  description: 'A geographic point in longitude, latitude order (WGS84).',
  positional: [
    {name: 'longitude', description: 'Longitude in degrees.', type: longitude},
    {name: 'latitude', description: 'Latitude in degrees.', type: latitude},
  ],
  returns: geographicPoint,
  resolve: ({positional: [lng, lat]}) => ({longitude: lng.value, latitude: lat.value}),
});
