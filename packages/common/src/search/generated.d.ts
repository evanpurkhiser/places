import type {nodes} from './nodes.ts';
import type {Query, SourceSpan} from './types.ts';

export function parse(input: string, options: {nodes: typeof nodes}): Query;
export class SyntaxError extends Error {
  location: SourceSpan['location'];
}
