import {defineFilter} from '@places/common/filter-engine';

import {geographicPredicate} from './data-types/geographic-predicate.ts';

export const location = defineFilter({
  name: 'location',
  description: 'Match places using a geographic condition.',
  examples: [
    {
      query: 'location[sector("Union Square, NYC", towards:"East Village, NYC")]',
      description: 'Places in a buffered sector heading towards the East Village.',
    },
    {
      query: 'location[radius("East Village, NY", 1mi)]',
      description: 'Places within one mile of the resolved neighborhood point.',
    },
    {
      query: 'location[radius(point(-73.985, 40.726), 800m)]',
      description: 'Places within 800 meters of the given point.',
    },
    {
      query: 'location[rect(point(-74.03, 40.76), point(-73.95, 40.70))]',
      description: 'Places inside the given map bounds, including edges.',
    },
  ],
  positional: [
    {name: 'condition', description: 'Geographic condition.', type: geographicPredicate},
  ],
  compile: ({positional: [condition]}) => condition.value,
});
