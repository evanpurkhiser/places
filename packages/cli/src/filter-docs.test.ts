import {expect, it} from 'vitest';

import {formatFilterDocs} from './filter-docs.ts';

it('renders signatures, optional arguments, capabilities, and examples as text', () => {
  const output = formatFilterDocs({
    filters: [
      {
        name: 'tag',
        description: 'Match an assigned tag.',
        presence: true,
        examples: [{query: 'tag[type.cafe]', description: 'Find cafes.'}],
        parameters: [
          {
            name: 'pattern',
            description: 'Tag pattern.',
            type: 'text',
            optional: false,
            operators: ['='],
          },
          {
            name: 'notes',
            description: 'Assignment note.',
            type: 'text',
            optional: true,
            operators: [],
          },
        ],
      },
    ],
    functions: [
      {
        name: 'label',
        description: 'Resolve a label.',
        returns: 'text',
        parameters: [],
        examples: [{query: 'tag[label()]'}],
      },
    ],
    values: [
      {name: 'text', description: 'A text pattern.', literals: true, references: true},
    ],
  });

  expect(output).toContain('tag[pattern:<text>, notes:<text>?]');
  expect(output).toContain('notes: text (optional) — Assignment note.');
  expect(output).toContain('Operators: =');
  expect(output).toContain('Presence: has[tag]');
  expect(output).toContain('Example: tag[type.cafe]\n    Find cafes.');
  expect(output).toContain('Example: tag[label()]');
  expect(output).toContain('label() -> text');
  expect(output).toContain('Accepts: literals, @references, label()');
});

it('only advertises functions registered for each value', () => {
  const values = [
    {name: 'text', description: 'Text.', literals: true, references: false},
    {name: 'point', description: 'Point.', literals: false, references: true},
  ];
  const output = formatFilterDocs({filters: [], functions: [], values});
  expect(output).not.toContain('Functions');
  expect(output).not.toContain('functions returning');
  expect(output).toContain('Accepts: literals');
  expect(output).toContain('Accepts: @references');

  const withFunction = formatFilterDocs({
    filters: [],
    values,
    functions: [
      {
        name: 'origin',
        description: 'Origin point.',
        returns: 'point',
        parameters: [],
        examples: [],
      },
    ],
  });
  expect(withFunction).toContain('Text.\n  Accepts: literals\n');
  expect(withFunction).toContain('Point.\n  Accepts: @references, origin()');
});
