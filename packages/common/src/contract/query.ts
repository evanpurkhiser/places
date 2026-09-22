import {oc} from '@orpc/contract';
import {z} from 'zod';

const parameter = z.object({
  name: z.string(),
  description: z.string(),
  type: z.string(),
  optional: z.boolean(),
  operators: z.array(z.enum(['=', '<', '<=', '>', '>='])),
});
const signature = z.object({
  name: z.string(),
  description: z.string(),
  examples: z.array(z.object({query: z.string(), description: z.string().optional()})),
  parameters: z.array(parameter),
});

export const queryDescription = z.object({
  types: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      literals: z.boolean(),
      references: z.boolean(),
    }),
  ),
  filters: z.array(signature.extend({presence: z.boolean()})),
  functions: z.array(signature.extend({returns: z.string()})),
});

export const queryContract = {
  describe: oc.output(queryDescription),
};
