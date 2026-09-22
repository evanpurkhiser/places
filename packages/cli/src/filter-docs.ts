import type {
  EngineDescription,
  ParameterDescription,
  SignatureDescription,
} from '@places/common/filter-engine';

function parameterLabel(parameter: ParameterDescription): string {
  return `${parameter.name}:<${parameter.type}>${parameter.optional ? '?' : ''}`;
}

function signature(definition: SignatureDescription, kind: 'filter' | 'function') {
  const parameters = definition.parameters.map(parameterLabel).join(', ');
  return kind === 'filter'
    ? `${definition.name}[${parameters}]`
    : `${definition.name}(${parameters})`;
}

function details(definition: SignatureDescription): string[] {
  const parameters = definition.parameters.flatMap(parameter => [
    `  ${parameter.name}: ${parameter.type}${parameter.optional ? ' (optional)' : ''} — ${parameter.description}`,
    ...(parameter.operators.length
      ? [`    Operators: ${parameter.operators.join(', ')}`]
      : []),
  ]);
  return [
    `  ${definition.description}`,
    ...parameters,
    ...definition.examples.flatMap(example => [
      `  Example: ${example.query}`,
      ...(example.description ? [`    ${example.description}`] : []),
    ]),
  ];
}

function section(title: string, lines: string[]): string[] {
  if (!lines.length) {
    return [];
  }

  return ['', title, ...lines];
}

export function formatFilterDocs(documentation: EngineDescription): string {
  return [
    'Filter language',
    '',
    "Use places list --query '<expression>' to filter saved places.",
    'Combine filters with AND, OR, !, and parentheses.',
    'Whitespace between filters means AND. ! binds before AND, then OR.',
    '  (tag[favorite] OR tag["date night"]) !has[notes]',
    '',
    'Use double quotes around values containing whitespace or syntax characters:',
    `  name["Joe's (Downtown)"]`,
    String.raw`Inside quotes, \" escapes a quote, \\ a backslash, and \* a literal star.`,
    'An unescaped * matches zero or more characters, even inside quotes.',
    'Arguments fill parameters in order or by name; ? marks an optional one.',
    ...section(
      'Filters',
      documentation.filters.flatMap(filter => [
        '',
        signature(filter, 'filter'),
        ...details(filter),
        ...(filter.presence ? [`  Presence: has[${filter.name}]`] : []),
      ]),
    ),
    ...section(
      'Functions',
      documentation.functions.flatMap(fn => [
        '',
        `${signature(fn, 'function')} -> ${fn.returns}`,
        ...details(fn),
      ]),
    ),
    ...section(
      'Value types',
      documentation.values.flatMap(type => [
        '',
        type.name,
        `  ${type.description}`,
        `  Accepts: ${[
          ...(type.literals ? ['literals'] : []),
          ...(type.references ? ['@references'] : []),
          ...documentation.functions
            .filter(fn => fn.returns === type.name)
            .map(fn => `${fn.name}()`),
        ].join(', ')}`,
      ]),
    ),
  ].join('\n');
}
