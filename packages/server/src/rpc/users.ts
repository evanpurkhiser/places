import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';
import {asc} from 'drizzle-orm';

import type {Context} from '../context.ts';
import {users} from '../db/schema.ts';

const api = implement(contract.users).$context<Context>();

export const userRouter = api.router({
  list: api.list.handler(async ({context: {db}}) => ({
    users: await db
      .select({id: users.id, username: users.username})
      .from(users)
      .orderBy(asc(users.username)),
  })),
});
