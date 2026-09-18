import {parse, SyntaxError} from './generated.js';
import {nodes} from './nodes.ts';
import type {Diagnostic, Query} from './types.ts';

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
  try {
    return parse(input, {nodes});
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SearchError([
        {code: 'syntax', message: error.message, location: error.location},
      ]);
    }

    throw error;
  }
}
