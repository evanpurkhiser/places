import {oc} from '@orpc/contract';
import {z} from 'zod';

import {mcpTools} from './mcp.ts';

export const userContract = {
  list: oc.meta(mcpTools.users.list).output(
    z.object({
      users: z
        .array(
          z.object({
            id: z.uuid().describe('Places user UUID.'),
            username: z.string().describe('Places username.'),
          }),
        )
        .describe('Places users ordered by username.'),
    }),
  ),
};
