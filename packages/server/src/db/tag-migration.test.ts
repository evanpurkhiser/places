import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';

import {randomUUID} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {temporaryDatabase} from '../fixtures/database.ts';

import type {Database} from './index.ts';

const testUrl = process.env.TEST_DATABASE_URL;
const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

async function seedLegacyTags(db: Database) {
  const namespaceId = randomUUID();
  const tagId = randomUUID();
  const bareTagId = randomUUID();
  const placeId = randomUUID();
  const listNamespaceId = randomUUID();
  const dottedNamespaceId = randomUUID();
  const listTagId = randomUUID();
  const dottedBareTagId = randomUUID();
  const dottedNamespaceTagId = randomUUID();
  await db.$client.query('INSERT INTO namespaces (id, name) VALUES ($1, $2)', [
    namespaceId,
    'type',
  ]);
  await db.$client.query(
    `INSERT INTO tags (id, name, namespace_id, description) VALUES
     ($1, 'type:cafe', $2, 'Coffee shops'), ($3, 'favorite', NULL, NULL)`,
    [tagId, namespaceId, bareTagId],
  );
  await db.$client.query(
    `INSERT INTO namespaces (id, name) VALUES ($1, 'gmaps-list'), ($2, 'trip.lists')`,
    [listNamespaceId, dottedNamespaceId],
  );
  await db.$client.query(
    `INSERT INTO tags (id, name, namespace_id) VALUES
     ($1, 'gmaps-list:[25.08] albert trip', $2),
     ($3, 'worth.a.visit', NULL),
     ($4, 'trip.lists:nyc.2026', $5)`,
    [
      listTagId,
      listNamespaceId,
      dottedBareTagId,
      dottedNamespaceTagId,
      dottedNamespaceId,
    ],
  );
  await db.$client.query(
    `INSERT INTO places (id, google_place_id, name, formatted_address, coordinates)
     VALUES ($1, 'test', 'Cafe', 'New York', 'SRID=4326;POINT(-74 40.7)')`,
    [placeId],
  );
  await db.$client.query(
    `INSERT INTO place_tags (place_id, tag_id, note) VALUES ($1, $2, 'Try the espresso')`,
    [placeId, tagId],
  );
  return {
    namespaceId,
    tagId,
    bareTagId,
    placeId,
    listNamespaceId,
    dottedNamespaceId,
    listTagId,
    dottedBareTagId,
    dottedNamespaceTagId,
  };
}

describe.skipIf(!testUrl)('dot tag namespace migration', () => {
  const {db, create, close} = temporaryDatabase('places_test', testUrl);

  beforeAll(async () => {
    await create();
    const folder = await mkdtemp(join(tmpdir(), 'places-tag-migration-'));

    try {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
      );
      const entries = journal.entries.filter((entry: {idx: number}) => entry.idx < 9);
      await mkdir(join(folder, 'meta'));
      await writeFile(
        join(folder, 'meta/_journal.json'),
        JSON.stringify({...journal, entries}),
      );

      for (const entry of entries) {
        await cp(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(folder, `${entry.tag}.sql`),
        );
      }

      await migrate(db, {migrationsFolder: folder});
    } finally {
      await rm(folder, {recursive: true, force: true});
    }
  }, 30000);

  afterAll(close);

  it('converts separators and existing dots while preserving tag identity', async () => {
    const {
      namespaceId,
      tagId,
      bareTagId,
      placeId,
      listNamespaceId,
      dottedNamespaceId,
      listTagId,
      dottedBareTagId,
      dottedNamespaceTagId,
    } = await seedLegacyTags(db);

    await migrate(db, {migrationsFolder});

    const result = await db.$client.query(
      'SELECT id, name, namespace_id, description FROM tags ORDER BY name',
    );
    expect(result.rows).toEqual([
      {id: bareTagId, name: 'favorite', namespace_id: null, description: null},
      {
        id: listTagId,
        name: 'gmaps-list.[25-08] albert trip',
        namespace_id: listNamespaceId,
        description: null,
      },
      {
        id: dottedNamespaceTagId,
        name: 'trip-lists.nyc-2026',
        namespace_id: dottedNamespaceId,
        description: null,
      },
      {
        id: tagId,
        name: 'type.cafe',
        namespace_id: namespaceId,
        description: 'Coffee shops',
      },
      {id: dottedBareTagId, name: 'worth-a-visit', namespace_id: null, description: null},
    ]);
    const namespace = await db.$client.query(
      'SELECT name FROM namespaces WHERE id = $1',
      [dottedNamespaceId],
    );
    expect(namespace.rows).toEqual([{name: 'trip-lists'}]);
    const assignments = await db.$client.query(
      'SELECT place_id, tag_id, note FROM place_tags',
    );
    expect(assignments.rows).toEqual([
      {place_id: placeId, tag_id: tagId, note: 'Try the espresso'},
    ]);
  });
});
