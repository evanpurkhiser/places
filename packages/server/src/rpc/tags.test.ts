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
import {createGooglePlaces} from '../services/google/index.ts';

const exec = promisify(execFile);
const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('tag API and CLI against PostgreSQL', () => {
  const databaseName = `places_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');

  url.pathname = `/${databaseName}`;

  const db = createDatabase(url.href);
  const config = configSchema.parse({database: {url: url.href}});
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

    expect(await (await app.request('/context-test')).json()).toEqual({
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

  it('normalizes, lists, reads, renames, and deletes tags through RPC', async () => {
    const cafe = await client.tags.create({name: '  Type:CAFE\t'});
    const bakery = await client.tags.create({name: 'bakery'});

    expect(cafe.name).toBe('type:cafe');
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
      const tag = JSON.parse((await cli('create', ' Type:CAFE ')).stdout);

      expect(tag.name).toBe('type:cafe');
      expect(JSON.parse((await cli('list')).stdout)).toEqual([tag]);
      expect(JSON.parse((await cli('get', tag.id)).stdout)).toEqual(tag);
      expect(JSON.parse((await cli('update', tag.id, 'Coffee')).stdout).name).toBe(
        'coffee',
      );
      await expect(cli('create', 'coffee')).rejects.toMatchObject({code: 1});
      await cli('delete', tag.id);
      await expect(cli('get', tag.id)).rejects.toMatchObject({code: 1});
      await expect(cli('create', '   ')).rejects.toMatchObject({code: 1});
      expect(JSON.parse((await cli('list')).stdout)).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      );
    }
  }, 20000);
});
