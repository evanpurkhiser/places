import {parse, SyntaxError} from './generated.js';
import {nodes} from './nodes.ts';
import type {Diagnostic, Query, Value} from './types.ts';

const parseWithStartRule = parse as unknown as (
  input: string,
  options: {nodes: typeof nodes; startRule: 'query' | 'standalone_value'},
) => Query | Value;

export class SearchError extends Error {
  diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(diagnostics.map(diagnostic => diagnostic.message).join('; '));
    this.name = 'SearchError';
    this.diagnostics = diagnostics;
  }
}

/**
 * Parse query syntax into an AST for the filter engine to validate.
 */
export function parseQuery(input: string): Query {
  return parseSyntax(input, 'query') as Query;
}

/**
 * Parse one query-language value, including registered function syntax.
 */
export function parseValue(input: string): Value {
  return parseSyntax(input, 'standalone_value') as Value;
}

function parseSyntax(
  input: string,
  startRule: 'query' | 'standalone_value',
): Query | Value {
  try {
    return parseWithStartRule(input, {nodes, startRule});
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SearchError([
        {code: 'syntax', message: error.message, location: error.location},
      ]);
    }

    throw error;
  }
}
