import {defineFilter} from '../definitions.ts';
import {duration} from '../values/duration.ts';
import {time} from '../values/time.ts';

export const open = defineFilter({
  name: 'open',
  supportsPresence: false,
  description:
    'Match the saved recurring opening schedule at a time, or continuously throughout an interval. Unknown hours remain unknown under negation. Known business closures fail the match. Holiday exceptions are not included. Dated intervals support up to 31 days.',
  examples: [
    {query: 'open[@now]', description: 'Open at the current instant.'},
    {query: 'open[6pm]', description: 'Open today at 6pm in each place’s time zone.'},
    {
      query: 'open["MON 6pm", for:2h]',
      description: 'Open continuously Monday from 6pm to 8pm.',
    },
    {
      query: 'open["mon 6pm", until:"tue 2am"]',
      description: 'Open continuously Monday evening through Tuesday at 2am.',
    },
    {
      query: 'open["2026-09-21T18:00:00-04:00", for:2h]',
      description: 'Open for two elapsed hours from a specific instant.',
    },
    {query: '!open[@now]', description: 'Known to be closed at the current instant.'},
  ],
  parameters: {
    time: {
      description: 'An instant, local clock time, or recurring weekday/time.',
      type: time,
    },
    for: {
      description:
        'Required continuous duration. Weekly times use wall-clock minutes; dated times use elapsed minutes. Mutually exclusive with until.',
      type: duration,
      optional: true,
    },
    until: {
      description:
        'Exclusive endpoint, with the same time kind as the start. Weekly endpoints wrap forward across Sunday; clock endpoints are on the same local date.',
      type: time,
      optional: true,
    },
  },
  validate: args => {
    if (args.some(arg => arg.name === 'for') && args.some(arg => arg.name === 'until')) {
      return 'open accepts either for or until, not both';
    }
  },
});
