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
        positional: [
          {
            name: 'pattern',
            description: 'Tag pattern.',
            type: 'text',
            optional: false,
            operators: ['='],
          },
        ],
        named: [
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
        positional: [],
        named: [],
        examples: [{query: 'tag[label()]'}],
      },
    ],
    types: [
      {name: 'text', description: 'A text pattern.', literals: true, references: true},
    ],
  });

  expect(output).toContain('tag[<pattern>, notes:<text>?]');
  expect(output).toContain('notes: text (optional) — Assignment note.');
  expect(output).toContain('Operators: =');
  expect(output).toContain('Presence: has[tag]');
  expect(output).toContain('Example: tag[type.cafe]\n    Find cafes.');
  expect(output).toContain('Example: tag[label()]');
  expect(output).toContain('label() -> text');
  expect(output).toContain('Accepts: literals, @references, label()');
});

it('only advertises functions registered for each type', () => {
  const types = [
    {name: 'text', description: 'Text.', literals: true, references: false},
    {name: 'point', description: 'Point.', literals: false, references: true},
  ];
  const output = formatFilterDocs({filters: [], functions: [], types});
  expect(output).not.toContain('Functions');
  expect(output).not.toContain('functions returning');
  expect(output).toContain('Accepts: literals');
  expect(output).toContain('Accepts: @references');

  const withFunction = formatFilterDocs({
    filters: [],
    types,
    functions: [
      {
        name: 'origin',
        description: 'Origin point.',
        returns: 'point',
        positional: [],
        named: [],
        examples: [],
      },
    ],
  });
  expect(withFunction).toContain('Text.\n  Accepts: literals\n');
  expect(withFunction).toContain('Point.\n  Accepts: @references, origin()');
});
