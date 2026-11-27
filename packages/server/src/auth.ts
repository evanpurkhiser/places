import {eq} from 'drizzle-orm';
import {createMiddleware} from 'hono/factory';

import {createHash} from 'node:crypto';

import type {Context} from './context.ts';
import {users} from './db/schema.ts';
import {defaultUserQuery} from './db/users.ts';

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export const identifyUser = createMiddleware<{Variables: Context}>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  const token = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(authorization ?? '')?.[1];
  const db = c.var.db;
  const userQuery =
    authorization === undefined
      ? defaultUserQuery(db)
      : token &&
        db
          .select({id: users.id})
          .from(users)
          .where(eq(users.tokenHash, hashToken(token)));

  if (userQuery) {
    const [user] = await userQuery;

    if (user) {
      c.set('userId', user.id);
      return next();
    }
  }

  if (authorization === undefined) {
    return c.json({error: 'Default Places user is unavailable.'}, 503);
  }

  c.header('WWW-Authenticate', 'Bearer');
  return c.json({error: 'Invalid Places credentials.'}, 401);
});
