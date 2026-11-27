import {eq} from 'drizzle-orm';
import {createMiddleware} from 'hono/factory';

import {createHash} from 'node:crypto';

import type {RequestContext} from './context.ts';
import type {Database} from './db/index.ts';
import {users} from './db/schema.ts';
import {defaultUserQuery} from './db/users.ts';

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function findUser(db: Database, authorization: string | undefined) {
  if (authorization === undefined) {
    const [user] = await defaultUserQuery(db);
    return user;
  }

  const token = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization)?.[1];
  if (!token) {
    return;
  }

  const [user] = await db
    .select({id: users.id})
    .from(users)
    .where(eq(users.tokenHash, hashToken(token)));
  return user;
}

export const identifyUser = createMiddleware<{Variables: RequestContext}>(
  async (c, next) => {
    const authorization = c.req.header('Authorization');
    const user = await findUser(c.var.db, authorization);

    if (user) {
      c.set('userId', user.id);
      return next();
    }

    if (authorization === undefined) {
      return c.json({error: 'Default Places user is unavailable.'}, 503);
    }

    c.header('WWW-Authenticate', 'Bearer');
    return c.json({error: 'Invalid Places credentials.'}, 401);
  },
);
