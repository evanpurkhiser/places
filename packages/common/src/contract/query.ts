import {oc} from '@orpc/contract';
import {z} from 'zod';

import {mcpTools} from './mcp.ts';

const parameter = z.object({
  name: z.string().describe('Parameter name used in a query expression.'),
  description: z.string().describe('Purpose and accepted values of the parameter.'),
  type: z.string().describe('Registered value type accepted by the parameter.'),
  optional: z.boolean().describe('Whether the parameter may be omitted.'),
  operators: z
    .array(z.enum(['=', '<', '<=', '>', '>=']))
    .describe('Comparison operators accepted by the parameter.'),
});
const signature = z.object({
  name: z.string().describe('Name used in a query expression.'),
  description: z.string().describe('Purpose and behavior.'),
  examples: z
    .array(
      z.object({
        query: z.string().describe('Valid example query.'),
        description: z.string().optional().describe('What the example matches.'),
      }),
    )
    .describe('Example query expressions.'),
  parameters: z.array(parameter).describe('Accepted parameters in positional order.'),
});

export const queryDescription = z.object({
  values: z
    .array(
      z.object({
        name: z.string().describe('Registered value type name.'),
        description: z.string().describe('Values represented by the type.'),
        literals: z.boolean().describe('Whether literal values are accepted.'),
        references: z.boolean().describe('Whether @name references are accepted.'),
      }),
    )
    .describe('Registered value types.'),
  filters: z
    .array(
      signature.extend({
        presence: z
          .boolean()
          .describe('Whether has[filter] presence checks are supported.'),
      }),
    )
    .describe('Available query filters.'),
  functions: z
    .array(
      signature.extend({
        returns: z.string().describe('Registered value type returned by the function.'),
      }),
    )
    .describe('Available query functions.'),
});

export const queryContract = {
  describe: oc.meta(mcpTools.query.describe).output(queryDescription),
};
