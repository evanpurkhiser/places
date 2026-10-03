import {defineFilter} from '../definitions.ts';
import {equality} from '../operators.ts';
import {uuid} from '../values/uuid.ts';

export const id = defineFilter({
  name: 'id',
  supportsPresence: false,
  description: 'Match a saved place by its UUID.',
  examples: [
    {
      query: 'id["10000000-0000-4000-8000-000000000001"]',
      description: 'Match one saved place exactly.',
    },
  ],
  parameters: {
    id: {
      description: 'Exact saved place UUID.',
      type: uuid,
      operators: equality,
    },
  },
});
