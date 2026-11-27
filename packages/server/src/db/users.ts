import {eq, sql} from 'drizzle-orm';

import type {Database} from './index.ts';
import {users} from './schema.ts';

export function defaultUserQuery(db: Pick<Database, 'select'>) {
  return db.select({id: users.id}).from(users).where(eq(users.isDefault, true));
}

export function defaultUserId(db: Pick<Database, 'select'>) {
  return sql<string>`(${defaultUserQuery(db)})`;
}
