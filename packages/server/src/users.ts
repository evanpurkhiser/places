import {merge, object, or} from '@optique/core/constructs';
import {message} from '@optique/core/message';
import {optional} from '@optique/core/modifiers';
import type {InferValue} from '@optique/core/parser';
import {argument, command, constant, option} from '@optique/core/primitives';
import {string} from '@optique/core/valueparser';
import {run} from '@optique/run';
import {zod} from '@optique/zod';
import {desc, eq, sql} from 'drizzle-orm';
import {z} from 'zod';

import {randomBytes} from 'node:crypto';

import {hashToken} from './auth.ts';
import {readConfig} from './config.ts';
import {createDatabase, type Database} from './db/index.ts';
import {users} from './db/schema.ts';

const username = argument(
  zod(z.string().regex(/^[a-z0-9][a-z0-9_-]*$/), {metavar: 'USERNAME', placeholder: ''}),
  {description: message`Use lowercase letters, digits, underscores, and hyphens.`},
);
const id = argument(zod(z.uuid(), {metavar: 'USER_ID', placeholder: ''}), {
  description: message`User UUID shown by users list.`,
});

const parser = merge(
  object({
    config: optional(
      option('--config', string({metavar: 'PATH'}), {
        description: message`Path to the Places server YAML config.`,
      }),
    ),
  }),
  or(
    command('list', object({action: constant('list')}), {
      description: message`List users and their credential status.`,
    }),
    command('create', object({action: constant('create'), username}), {
      description: message`Create a user.`,
    }),
    command('rename', object({action: constant('rename'), id, username}), {
      description: message`Change a user's username.`,
    }),
    command('rotate-token', object({action: constant('rotate-token'), id}), {
      description: message`Replace a user's credential and print the new bearer token.`,
    }),
    command('revoke-token', object({action: constant('revoke-token'), id}), {
      description: message`Revoke a user's bearer token.`,
    }),
  ),
);

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

async function manageUsers(db: Database, args: InferValue<typeof parser>) {
  switch (args.action) {
    case 'list':
      return db
        .select(userSummary)
        .from(users)
        .orderBy(desc(users.isDefault), users.username);
    case 'create': {
      const [user] = await db
        .insert(users)
        .values({username: args.username})
        .returning(userSummary);
      return user;
    }
    case 'rename':
      return updateUser(db, args.id, {username: args.username});
    case 'rotate-token': {
      const token = randomBytes(32).toString('base64url');
      await updateUser(db, args.id, {tokenHash: hashToken(token)});
      return token;
    }
    case 'revoke-token':
      return updateUser(db, args.id, {tokenHash: null});
  }
}

const args = run(parser, {
  programName: 'places users',
  help: {option: {names: ['-h', '--help']}},
  brief: message`Manage users from the Places server host.`,
  description: message`Token rotation prints the new token once. Other commands print JSON.`,
});

try {
  const config = await readConfig(args.config ?? process.env.PLACES_CONFIG_PATH);
  const db = createDatabase(config.database.url);

  try {
    const result = await manageUsers(db, args);
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  } finally {
    await db.$client.end();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'User management failed.');
  process.exitCode = 1;
}
