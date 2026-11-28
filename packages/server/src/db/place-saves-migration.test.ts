import {readMigrationFiles} from 'drizzle-orm/migrator';
import {Pool} from 'pg';
import {expect, it} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {createDatabase} from './index.ts';
import {placeSaves} from './schema.ts';

const testUrl = process.env.TEST_DATABASE_URL;

it.skipIf(!testUrl)(
  'preserves existing place savers and their original timestamps',
  async () => {
    const databaseName = `places_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({connectionString: testUrl});
    const url = new URL(testUrl ?? 'postgres://localhost/places');
    url.pathname = `/${databaseName}`;
    const db = createDatabase(url.href);

    try {
      await admin.query(`CREATE DATABASE "${databaseName}"`);
      const migrations = readMigrationFiles({
        migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
      });
      const migrationIndex = migrations.findIndex(migration =>
        migration.sql.some(statement => statement.includes('CREATE TABLE "place_saves"')),
      );
      expect(migrationIndex).toBeGreaterThan(0);
      const setupStatements = migrations
        .slice(0, migrationIndex)
        .flatMap(migration => migration.sql);

      const connection = await db.$client.connect();
      try {
        for (const statement of setupStatements) {
          await connection.query(statement);
        }

        const placeId = randomUUID();
        const userId = randomUUID();
        const savedAt = new Date('2026-01-02T03:04:05Z');
        await connection.query('INSERT INTO users (id, username) VALUES ($1, $2)', [
          userId,
          'existing-saver',
        ]);
        await connection.query(
          `INSERT INTO places (id, google_place_id, name, formatted_address, coordinates, added_by_user_id, created_at, deleted_at)
         VALUES ($1, 'cafe', 'Cafe', 'New York', 'SRID=4326;POINT(-74 40.7)', $2, $3, now())`,
          [placeId, userId, savedAt],
        );

        for (const statement of migrations[migrationIndex]!.sql) {
          await connection.query(statement);
        }

        expect(await db.select().from(placeSaves)).toEqual([{placeId, userId, savedAt}]);
      } finally {
        connection.release();
      }
    } finally {
      await db.$client.end();
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end();
    }
  },
  30000,
);
