import {defineFilter} from '../definitions.ts';
import {equality} from '../operators.ts';
import {textLiteral} from '../values/text-literal.ts';

export const savedBy = defineFilter({
  name: 'savedBy',
  supportsPresence: false,
  description: 'Match places saved by a Places user.',
  examples: [{query: 'savedBy[evan]', description: 'Places Evan saved.'}],
  parameters: {
    username: {
      description: 'Exact Places username.',
      type: textLiteral,
      operators: equality,
    },
  },
});
