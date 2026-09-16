import {migrate} from 'drizzle-orm/node-postgres/migrator';

import {fileURLToPath} from 'node:url';

import {loadConfig} from '../config.ts';

import {createDatabase} from './index.ts';

const config = await loadConfig();
const db = createDatabase(config.database.url);

try {
  await migrate(db, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
} finally {
  await db.$client.end();
}
