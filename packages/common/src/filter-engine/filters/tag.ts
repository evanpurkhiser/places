import {defineFilter} from '../definitions.ts';
import {equality} from '../operators.ts';
import {tagName} from '../values/tag-name.ts';
import {text} from '../values/text.ts';

export const tag = defineFilter({
  name: 'tag',
  supportsPresence: true,
  description:
    'Match an assigned tag, optionally with notes on the same assignment. Prefix with ! to select places where no assignment matches both conditions.',
  examples: [
    {query: 'tag[favorite]', description: 'Places assigned the favorite tag.'},
    {query: 'tag["date night"]', description: 'Places assigned a tag containing spaces.'},
    {query: 'tag[type.cafe]', description: 'Places assigned the type.cafe tag.'},
    {
      query: 'tag[type.*]',
      description: 'Places with a tag in the type namespace.',
    },
    {
      query: 'tag[laptop-friendly, notes:outlet]',
      description:
        'Places whose laptop-friendly tag assignment has a note mentioning outlets.',
    },
    {
      query: 'tag[laptop-friendly, notes:="power outlets"]',
      description:
        'Match an assignment whose complete note is "power outlets", ignoring case.',
    },
    {
      query: '!tag[laptop-friendly, notes:outlet]',
      description:
        'Places where no laptop-friendly assignment has a note containing outlet; includes places without the tag.',
    },
    {
      query: 'tag[laptop-friendly] !tag[laptop-friendly, notes:outlet]',
      description:
        'Require the tag, but exclude places whose assignment note mentions outlet.',
    },
  ],
  parameters: {
    name: {
      description: 'Assigned tag name or wildcard pattern.',
      type: tagName,
      operators: equality,
    },
    notes: {
      description: 'Match the note on the same tag assignment.',
      type: text,
      operators: equality,
      optional: true,
    },
  },
});
