import {Pool} from 'pg';

import {randomUUID} from 'node:crypto';

import {createDatabase} from '../db/index.ts';

export function temporaryDatabase(prefix: string, testUrl?: string) {
  const name = `${prefix}_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');
  url.pathname = `/${name}`;
  const db = createDatabase(url.href);

  return {
    db,
    url,
    create: () => admin.query(`CREATE DATABASE "${name}"`),
    async close() {
      await db.$client.end();
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
