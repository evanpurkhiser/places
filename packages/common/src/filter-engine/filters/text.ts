import {defineFilter} from '../definitions.ts';
import {equality} from '../operators.ts';
import {text} from '../values/text.ts';

const parameters = {
  pattern: {
    description: 'Text or wildcard pattern to match.',
    type: text,
    operators: equality,
  },
} as const;

export const name = defineFilter({
  name: 'name',
  supportsPresence: true,
  description: 'Match the saved place name.',
  examples: [
    {query: 'name[coffee]', description: 'Names containing coffee.'},
    {query: 'name[="La Cabra"]', description: 'Exactly La Cabra, ignoring case.'},
    {query: '!name[coffee]', description: 'Names that do not contain coffee.'},
  ],
  parameters,
});

export const address = defineFilter({
  name: 'address',
  supportsPresence: true,
  description: 'Match the formatted street address.',
  examples: [
    {
      query: 'address["Broadway"]',
      description: 'Formatted addresses containing Broadway.',
    },
  ],
  parameters,
});

export const notes = defineFilter({
  name: 'notes',
  supportsPresence: true,
  description:
    'Match the general place note. Absent or empty notes fail positive matches.',
  examples: [
    {query: 'notes[espresso]', description: 'General place notes mentioning espresso.'},
    {
      query: '!notes[espresso]',
      description:
        'Places without espresso in their general note, including places with no note.',
    },
  ],
  parameters,
});
