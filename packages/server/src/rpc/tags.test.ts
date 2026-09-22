import {serve} from '@hono/node-server';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {eq} from 'drizzle-orm';
import {migrate} from 'drizzle-orm/node-postgres/migrator';
import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {afterAll, beforeAll, beforeEach, describe, expect, it} from 'vitest';

import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

import {createApp} from '../app.ts';
import {configSchema} from '../config.ts';
import {createDatabase} from '../db/index.ts';
import {places, placeTags, tags} from '../db/schema.ts';
import {testConfig} from '../fixtures/config.ts';
import {createGooglePlaces} from '../services/google/index.ts';

const exec = promisify(execFile);
const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('tag API and CLI against PostgreSQL', () => {
  const databaseName = `places_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');

  url.pathname = `/${databaseName}`;

  const db = createDatabase(url.href);
  const config = configSchema.parse({...testConfig, database: {url: url.href}});
  const app = createApp({
    db,
    config,
    jobs: new PgBoss(url.href),
    google: createGooglePlaces(),
  });
  const client: Client = createORPCClient(
    new RPCLink({
      url: 'http://localhost/rpc',
      fetch: request => Promise.resolve(app.fetch(request)),
    }),
  );

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
    });
  }, 30000);

  it('provides config and database through Hono context', async () => {
    app.get('/context-test', c =>
      c.json({
        port: c.var.config.server.port,
        sameDatabase: c.var.db === db,
      }),
    );

    const response = await app.request('/context-test');
    expect(await response.json()).toEqual({
      port: config.server.port,
      sameDatabase: true,
    });
  });

  beforeEach(async () => {
    await db.delete(placeTags);
    await db.delete(places);
    await db.delete(tags);
  });

  afterAll(async () => {
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('hides archived tags while preserving lookup, assignments, and filtering', async () => {
    const tag = await client.tags.create({name: 'old-list'});
    expect(tag.archived).toBe(false);
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: 'archived-test',
        name: 'Cafe',
        formattedAddress: 'NYC',
        coordinates: 'SRID=4326;POINT(-74 40)',
      })
      .returning();
    await client.places.tag({
      placeId: place!.id,
      tag: tag.id,
      notes: 'Keep this context',
    });
    await client.tags.update({id: tag.id, archived: true});

    expect(await client.tags.list()).toEqual([]);
    expect(await client.tags.get({id: tag.id})).toMatchObject({archived: true});
    const matches = await client.places.list({query: 'tag[old-list]'});
    expect(matches.map(item => item.id)).toEqual([place!.id]);
    expect(matches[0]!.tags).toEqual([]);
    expect(await client.places.list({query: '!tag[old-list]'})).toEqual([]);
    expect(await client.places.list({query: 'has[tag]'})).toHaveLength(1);
    expect(await db.select().from(placeTags)).toHaveLength(1);
    expect(
      await client.tags.update({id: tag.id, description: 'Historical list'}),
    ).toMatchObject({archived: true});

    await client.tags.update({id: tag.id, archived: false});
    expect(await client.tags.list()).toHaveLength(1);
    const restored = await client.places.list({query: 'tag[old-list]'});
    expect(restored[0]!.tags).toMatchObject([
      {tag: {id: tag.id, archived: false}, note: 'Keep this context'},
    ]);
  });

  it('keeps archived tag names reserved', async () => {
    const created = await client.tags.create({name: 'historical'});
    const tag = await client.tags.update({id: created.id, archived: true});
    expect(tag.archived).toBe(true);
    expect(await client.tags.list()).toEqual([]);
    await expect(client.tags.create({name: 'historical'})).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(await client.tags.delete({id: tag.id})).toMatchObject({archived: true});
  });

  it('normalizes, lists, reads, renames, and deletes tags through RPC', async () => {
    const cafe = await client.tags.create({name: '  CAFE\t'});
    const bakery = await client.tags.create({name: 'bakery'});

    expect(cafe.name).toBe('cafe');
    expect(cafe.icon).toBeNull();
    expect(cafe.description).toBeNull();
    expect(cafe.createdAt).toBeInstanceOf(Date);
    expect(await client.tags.list()).toEqual([bakery, cafe]);
    expect(await client.tags.get({id: cafe.id})).toEqual(cafe);

    const renamed = await client.tags.update({id: cafe.id, name: '  Coffee '});

    expect(renamed).toMatchObject({
      id: cafe.id,
      name: 'coffee',
      createdAt: cafe.createdAt,
    });
    expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(cafe.updatedAt.getTime());
    expect(await client.tags.delete({id: cafe.id})).toEqual(renamed);
    expect(await client.tags.list()).toEqual([bakery]);
  });

  it('reports duplicate names, including concurrent creates and conflicting renames', async () => {
    const results = await Promise.allSettled([
      client.tags.create({name: ' Cafe '}),
      client.tags.create({name: 'cafe'}),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: {
        code: 'CONFLICT',
        status: 409,
        message: 'A tag with this name already exists',
      },
    });

    const other = await client.tags.create({name: 'other'});

    await expect(client.tags.update({id: other.id, name: 'CAFE'})).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'A tag with this name already exists',
    });
    expect(await client.tags.get({id: other.id})).toEqual(other);
  });

  it('creates, replaces, preserves, and clears tag icons', async () => {
    const tag = await client.tags.create({name: 'lunch', icon: {emoji: '🍱'}});

    expect(tag.icon).toEqual({emoji: '🍱'});
    const retrieved = await client.tags.get({id: tag.id});
    expect(retrieved.icon).toEqual({emoji: '🍱'});

    const updated = await client.tags.update({id: tag.id, icon: {emoji: '🍜'}});

    expect(updated).toMatchObject({name: 'lunch', icon: {emoji: '🍜'}});
    expect(await client.tags.update({id: tag.id, name: 'dinner'})).toMatchObject({
      name: 'dinner',
      icon: {emoji: '🍜'},
    });
    expect(await client.tags.update({id: tag.id, icon: null})).toMatchObject({
      name: 'dinner',
      icon: null,
    });
    const cleared = await client.tags.get({id: tag.id});
    expect(cleared.icon).toBeNull();
  });

  it('creates, edits, preserves, and clears tag descriptions', async () => {
    const tag = await client.tags.create({
      name: 'lunch',
      description: 'Weekday lunch spots',
    });

    expect(tag.description).toBe('Weekday lunch spots');
    expect(await client.tags.get({id: tag.id})).toEqual(tag);
    expect(
      await client.tags.update({id: tag.id, description: 'Quick lunches'}),
    ).toMatchObject({name: 'lunch', description: 'Quick lunches'});
    expect(
      await client.tags.update({id: tag.id, name: 'weekday', icon: {emoji: '🍱'}}),
    ).toMatchObject({description: 'Quick lunches'});
    expect(await client.tags.update({id: tag.id, description: null})).toMatchObject({
      name: 'weekday',
      icon: {emoji: '🍱'},
      description: null,
    });
    const cleared = await client.tags.get({id: tag.id});
    expect(cleared.description).toBeNull();
  });

  it.each([{}, {emoji: ''}, {emoji: 1}, {emoji: '🍱', url: 'icon.png'}])(
    'rejects invalid icon JSON %j',
    async icon => {
      const tag = await client.tags.create({name: 'lunch'});

      // Exercise runtime validation with values outside the client contract.
      const invalidIcon = icon as unknown as {emoji: string};

      await expect(
        client.tags.create({name: 'dinner', icon: invalidIcon}),
      ).rejects.toMatchObject({status: 400});
      await expect(
        client.tags.update({id: tag.id, icon: invalidIcon}),
      ).rejects.toMatchObject({status: 400});
      expect(await client.tags.get({id: tag.id})).toEqual(tag);
    },
  );

  it('validates input and reports missing tags', async () => {
    await expect(client.tags.create({name: ' \t '})).rejects.toMatchObject({status: 400});
    await expect(client.tags.get({id: 'invalid'})).rejects.toMatchObject({status: 400});

    const id = randomUUID();

    await expect(client.tags.get({id})).rejects.toMatchObject({code: 'NOT_FOUND'});
    await expect(client.tags.update({id, name: 'new'})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(client.tags.delete({id})).rejects.toMatchObject({code: 'NOT_FOUND'});
  });

  it('preserves associations when renamed and only removes associations when deleted', async () => {
    const tag = await client.tags.create({name: 'cafe'});
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: 'test-place',
        name: 'Test place',
        formattedAddress: 'Test address',
        coordinates: 'SRID=4326;POINT(-73.98 40.74)',
      })
      .returning();

    await db.insert(placeTags).values({placeId: place!.id, tagId: tag.id});
    await client.tags.update({id: tag.id, name: 'coffee'});
    expect(await db.select().from(placeTags)).toHaveLength(1);
    await client.tags.delete({id: tag.id});
    expect(await db.select().from(placeTags)).toEqual([]);
    expect(await db.select().from(places).where(eq(places.id, place!.id))).toHaveLength(
      1,
    );
  });

  it('runs the actual CLI through HTTP with JSON output and nonzero failures', async () => {
    const server = serve({fetch: app.fetch, hostname: '127.0.0.1', port: 15188});
    const cliPath = fileURLToPath(new URL('../../../cli/src/main.ts', import.meta.url));
    const cli = (...args: string[]) =>
      exec(process.execPath, [
        cliPath,
        '--server',
        'http://127.0.0.1:15188',
        'tags',
        ...args,
      ]);

    try {
      const createdOutput = await cli('create', ' CAFE ');
      const tag = JSON.parse(createdOutput.stdout);

      expect(tag.name).toBe('cafe');
      const listOutput = await cli('list');
      expect(JSON.parse(listOutput.stdout)).toEqual([tag]);
      const getOutput = await cli('get', tag.id);
      expect(JSON.parse(getOutput.stdout)).toEqual(tag);
      const updatedOutput = await cli('update', tag.id, 'Coffee');
      expect(JSON.parse(updatedOutput.stdout).name).toBe('coffee');
      await cli('update', tag.id, '--archive');
      const archivedList = await cli('list');
      const archivedTag = await cli('get', tag.id);
      expect(JSON.parse(archivedList.stdout)).toEqual([]);
      expect(JSON.parse(archivedTag.stdout).archived).toBe(true);
      await cli('update', tag.id, '--unarchive');
      const restoredList = await cli('list');
      expect(JSON.parse(restoredList.stdout)).toHaveLength(1);
      await expect(cli('create', 'coffee')).rejects.toMatchObject({code: 1});
      await cli('delete', tag.id);
      await expect(cli('get', tag.id)).rejects.toMatchObject({code: 1});
      await expect(cli('create', '   ')).rejects.toMatchObject({code: 1});
      const emptyOutput = await cli('list');
      expect(JSON.parse(emptyOutput.stdout)).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  }, 20000);
});
