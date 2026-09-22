import {defineFunction} from '../definitions.ts';
import {geographicPoint} from '../values/geographic-point.ts';
import {latitude} from '../values/latitude.ts';
import {longitude} from '../values/longitude.ts';

export const point = defineFunction({
  name: 'point',
  description: 'A geographic point in longitude, latitude order (WGS84).',
  parameters: {
    longitude: {description: 'Longitude in degrees.', type: longitude},
    latitude: {description: 'Latitude in degrees.', type: latitude},
  },
  returns: geographicPoint,
  evaluate: ({longitude, latitude}) => ({
    longitude: longitude.value,
    latitude: latitude.value,
  }),
});
