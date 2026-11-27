import {desc, eq, sql} from 'drizzle-orm';
import {z} from 'zod';

import {randomBytes} from 'node:crypto';
import {parseArgs} from 'node:util';

import {hashToken} from './auth.ts';
import {loadConfig} from './config.ts';
import {createDatabase, type Database} from './db/index.ts';
import {users} from './db/schema.ts';

const usage = `Usage: users [--config PATH] COMMAND

  list
  create USERNAME
  rename USER_ID USERNAME
  rotate-token USER_ID
  revoke-token USER_ID

Usernames use lowercase letters, digits, underscores, and hyphens.
rotate-token prints the new token once. Other commands print JSON.`;

const username = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/);
const userId = z.uuid();
const command = z.union([
  z.tuple([z.literal('list')]),
  z.tuple([z.literal('create'), username]),
  z.tuple([z.literal('rename'), userId, username]),
  z.tuple([z.literal('rotate-token'), userId]),
  z.tuple([z.literal('revoke-token'), userId]),
]);

const userSummary = {
  id: users.id,
  username: users.username,
  isDefault: users.isDefault,
  createdAt: users.createdAt,
  hasToken: sql<boolean>`${users.tokenHash} is not null`,
};

async function updateUser(
  db: Database,
  id: string,
  changes: Partial<Pick<typeof users.$inferInsert, 'username' | 'tokenHash'>>,
) {
  const [user] = await db
    .update(users)
    .set(changes)
    .where(eq(users.id, id))
    .returning(userSummary);

  if (!user) {
    throw new Error(`Places user ${id} does not exist.`);
  }

  return user;
}

async function manageUsers(
  db: Database,
  [action, target, newUsername]: z.infer<typeof command>,
) {
  switch (action) {
    case 'list':
      return db
        .select(userSummary)
        .from(users)
        .orderBy(desc(users.isDefault), users.username);
    case 'create': {
      const [user] = await db
        .insert(users)
        .values({username: target})
        .returning(userSummary);
      return user;
    }
    case 'rename':
      return updateUser(db, target, {username: newUsername});
    case 'rotate-token': {
      const token = randomBytes(32).toString('base64url');
      await updateUser(db, target, {tokenHash: hashToken(token)});
      return token;
    }
    case 'revoke-token':
      return updateUser(db, target, {tokenHash: null});
  }
}

async function main() {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {config: {type: 'string'}, help: {type: 'boolean', short: 'h'}},
  });

  if (values.help) {
    console.log(usage);
    return;
  }

  const parsed = command.safeParse(positionals);
  if (!parsed.success) {
    throw new Error(usage);
  }

  const config = await loadConfig(
    values.config === undefined ? [] : ['--config', values.config],
  );
  const db = createDatabase(config.database.url);

  try {
    const result = await manageUsers(db, parsed.data);
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } finally {
    await db.$client.end();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'User management failed.');
  process.exitCode = 1;
}
