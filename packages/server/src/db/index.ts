import {drizzle} from 'drizzle-orm/node-postgres';
import {Pool} from 'pg';

export function createDatabase(url: string) {
  const pool = new Pool({connectionString: url, connectionTimeoutMillis: 5000});

  pool.on('error', error => console.error('PostgreSQL pool error', error));

  return drizzle(pool);
}

export type Database = ReturnType<typeof createDatabase>;
