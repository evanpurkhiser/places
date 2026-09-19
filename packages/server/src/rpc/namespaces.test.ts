import {serve} from '@hono/node-server';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
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
import {namespaces} from '../db/schema.ts';
import {createGooglePlaces} from '../services/google/index.ts';

const exec = promisify(execFile);
const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('namespace API and CLI against PostgreSQL', () => {
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

  beforeEach(async () => {
    await db.delete(namespaces);
  });

  afterAll(async () => {
    await db.$client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('normalizes, lists, reads, renames, and deletes namespaces through RPC', async () => {
    const cafe = await client.namespaces.create({name: '  TYPE\t'});
    const bakery = await client.namespaces.create({name: 'bakery'});

    expect(cafe.name).toBe('type');
    expect(cafe.icon).toBeNull();
    expect(cafe.description).toBeNull();
    expect(cafe.createdAt).toBeInstanceOf(Date);
    expect(await client.namespaces.list()).toEqual([bakery, cafe]);
    expect(await client.namespaces.get({id: cafe.id})).toEqual(cafe);

    const renamed = await client.namespaces.update({id: cafe.id, name: '  Coffee '});

    expect(renamed).toMatchObject({
      id: cafe.id,
      name: 'coffee',
      createdAt: cafe.createdAt,
    });
    expect(renamed.updatedAt.getTime()).toBeGreaterThanOrEqual(cafe.updatedAt.getTime());
    expect(await client.namespaces.delete({id: cafe.id})).toEqual(renamed);
    expect(await client.namespaces.list()).toEqual([bakery]);
  });

  it('reports duplicate names, including concurrent creates and conflicting renames', async () => {
    const results = await Promise.allSettled([
      client.namespaces.create({name: ' Cafe '}),
      client.namespaces.create({name: 'cafe'}),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: {
        code: 'CONFLICT',
        status: 409,
        message: 'A namespace with this name already exists',
      },
    });

    const other = await client.namespaces.create({name: 'other'});

    await expect(
      client.namespaces.update({id: other.id, name: 'CAFE'}),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'A namespace with this name already exists',
    });
    expect(await client.namespaces.get({id: other.id})).toEqual(other);
  });

  it('creates, replaces, preserves, and clears namespace icons', async () => {
    const tag = await client.namespaces.create({name: 'lunch', icon: {emoji: '🍱'}});

    expect(tag.icon).toEqual({emoji: '🍱'});
    const retrieved = await client.namespaces.get({id: tag.id});
    expect(retrieved.icon).toEqual({emoji: '🍱'});

    const updated = await client.namespaces.update({id: tag.id, icon: {emoji: '🍜'}});

    expect(updated).toMatchObject({name: 'lunch', icon: {emoji: '🍜'}});
    expect(await client.namespaces.update({id: tag.id, name: 'dinner'})).toMatchObject({
      name: 'dinner',
      icon: {emoji: '🍜'},
    });
    expect(await client.namespaces.update({id: tag.id, icon: null})).toMatchObject({
      name: 'dinner',
      icon: null,
    });
    const cleared = await client.namespaces.get({id: tag.id});
    expect(cleared.icon).toBeNull();
  });

  it('creates, edits, preserves, and clears namespace descriptions', async () => {
    const tag = await client.namespaces.create({
      name: 'lunch',
      description: 'Weekday lunch spots',
    });

    expect(tag.description).toBe('Weekday lunch spots');
    expect(await client.namespaces.get({id: tag.id})).toEqual(tag);
    expect(
      await client.namespaces.update({id: tag.id, description: 'Quick lunches'}),
    ).toMatchObject({name: 'lunch', description: 'Quick lunches'});
    expect(
      await client.namespaces.update({id: tag.id, name: 'weekday', icon: {emoji: '🍱'}}),
    ).toMatchObject({description: 'Quick lunches'});
    expect(await client.namespaces.update({id: tag.id, description: null})).toMatchObject(
      {
        name: 'weekday',
        icon: {emoji: '🍱'},
        description: null,
      },
    );
    const cleared = await client.namespaces.get({id: tag.id});
    expect(cleared.description).toBeNull();
  });

  it.each([{}, {emoji: ''}, {emoji: 1}, {emoji: '🍱', url: 'icon.png'}])(
    'rejects invalid icon JSON %j',
    async icon => {
      const tag = await client.namespaces.create({name: 'lunch'});

      // Exercise runtime validation with values outside the client contract.
      const invalidIcon = icon as unknown as {emoji: string};

      await expect(
        client.namespaces.create({name: 'dinner', icon: invalidIcon}),
      ).rejects.toMatchObject({status: 400});
      await expect(
        client.namespaces.update({id: tag.id, icon: invalidIcon}),
      ).rejects.toMatchObject({status: 400});
      expect(await client.namespaces.get({id: tag.id})).toEqual(tag);
    },
  );

  it('validates input and reports missing namespaces', async () => {
    await expect(client.namespaces.create({name: ' \t '})).rejects.toMatchObject({
      status: 400,
    });
    await expect(client.namespaces.get({id: 'invalid'})).rejects.toMatchObject({
      status: 400,
    });

    const id = randomUUID();

    await expect(client.namespaces.get({id})).rejects.toMatchObject({code: 'NOT_FOUND'});
    await expect(client.namespaces.update({id, name: 'new'})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(client.namespaces.delete({id})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it.each(['', '  ', 'type:cafe'])('rejects invalid namespace names: %j', async name => {
    await expect(client.namespaces.create({name})).rejects.toMatchObject({status: 400});
    const namespace = await client.namespaces.create({name: 'type'});
    await expect(
      client.namespaces.update({id: namespace.id, name}),
    ).rejects.toMatchObject({status: 400});
    await expect(db.insert(namespaces).values({name})).rejects.toThrow();
    expect(await client.namespaces.get({id: namespace.id})).toEqual(namespace);
  });

  it('rejects empty updates', async () => {
    const namespace = await client.namespaces.create({name: 'type'});
    await expect(client.namespaces.update({id: namespace.id})).rejects.toMatchObject({
      status: 400,
    });
  });

  it('runs the actual CLI through HTTP with JSON output and nonzero failures', async () => {
    const server = serve({fetch: app.fetch, hostname: '127.0.0.1', port: 15191});
    const cliPath = fileURLToPath(new URL('../../../cli/src/main.ts', import.meta.url));
    const cli = (...args: string[]) =>
      exec(process.execPath, [
        cliPath,
        '--server',
        'http://127.0.0.1:15191',
        'ns',
        ...args,
      ]);

    try {
      const createdOutput = await cli('create', ' TYPE ');
      const tag = JSON.parse(createdOutput.stdout);

      expect(tag.name).toBe('type');
      const listOutput = await cli('list');
      expect(JSON.parse(listOutput.stdout)).toEqual([tag]);
      const getOutput = await cli('get', tag.id);
      expect(JSON.parse(getOutput.stdout)).toEqual(tag);
      const updatedOutput = await cli('update', tag.id, 'Coffee');
      expect(JSON.parse(updatedOutput.stdout).name).toBe('coffee');
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
