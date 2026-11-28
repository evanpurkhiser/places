import {readMigrationFiles} from 'drizzle-orm/migrator';
import type {PoolClient} from 'pg';
import {expect, it} from 'vitest';

import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

import {temporaryDatabase} from '../fixtures/database.ts';

import {placeSaves} from './schema.ts';

const testUrl = process.env.TEST_DATABASE_URL;

async function runStatements(connection: PoolClient, statements: readonly string[]) {
  for (const statement of statements) {
    await connection.query(statement);
  }
}

it.skipIf(!testUrl)(
  'preserves existing place savers and their original timestamps',
  async () => {
    const {db, create, close} = temporaryDatabase('places_test', testUrl);

    try {
      await create();
      const migrations = readMigrationFiles({
        migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
      });
      const migrationIndex = migrations.findIndex(migration =>
        migration.sql.some(statement => statement.includes('CREATE TABLE "place_saves"')),
      );
      expect(migrationIndex).toBeGreaterThan(0);

      const connection = await db.$client.connect();
      try {
        await runStatements(
          connection,
          migrations.slice(0, migrationIndex).flatMap(migration => migration.sql),
        );

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

        await runStatements(connection, migrations[migrationIndex]!.sql);

        expect(await db.select().from(placeSaves)).toEqual([{placeId, userId, savedAt}]);
      } finally {
        connection.release();
      }
    } finally {
      await close();
    }
  },
  30000,
);
