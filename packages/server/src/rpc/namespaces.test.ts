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
import {namespaces, tags, places, placeTags} from '../db/schema.ts';
import {testConfig} from '../fixtures/config.ts';
import {createGooglePlaces} from '../services/google/index.ts';

const exec = promisify(execFile);
const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('namespace API and CLI against PostgreSQL', () => {
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

  beforeEach(async () => {
    await db.delete(placeTags);
    await db.delete(places);
    await db.delete(tags);
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

  it.each(['', '  ', 'type.cafe'])('rejects invalid namespace names: %j', async name => {
    await expect(client.namespaces.create({name})).rejects.toMatchObject({status: 400});
    const namespace = await client.namespaces.create({name: 'type'});
    await expect(
      client.namespaces.update({id: namespace.id, name}),
    ).rejects.toMatchObject({status: 400});
    await expect(db.insert(namespaces).values({name})).rejects.toThrow();
    expect(await client.namespaces.get({id: namespace.id})).toEqual(namespace);
  });

  it('creates and moves tags using qualified names while preserving metadata', async () => {
    const type = await client.namespaces.create({name: 'type'});
    const cuisine = await client.namespaces.create({name: 'cuisine'});
    const tag = await client.tags.create({
      name: ' TYPE.CAFE ',
      icon: {emoji: '☕'},
      description: 'Coffee shops',
    });
    expect(tag).toMatchObject({name: 'type.cafe', namespaceId: type.id});
    expect(await client.tags.update({id: tag.id, description: 'Coffee'})).toMatchObject({
      name: 'type.cafe',
      namespaceId: type.id,
    });
    expect(await client.tags.update({id: tag.id, name: 'cuisine.coffee'})).toMatchObject({
      id: tag.id,
      name: 'cuisine.coffee',
      namespaceId: cuisine.id,
      icon: tag.icon,
      description: 'Coffee',
      createdAt: tag.createdAt,
    });
    expect(await client.tags.update({id: tag.id, name: 'coffee'})).toMatchObject({
      namespaceId: null,
      name: 'coffee',
    });
    expect(await client.tags.update({id: tag.id, name: 'type.coffee'})).toMatchObject({
      namespaceId: type.id,
      name: 'type.coffee',
    });
    await client.tags.create({name: 'cuisine.coffee'});
    await client.tags.create({name: 'coffee'});
    await expect(client.tags.create({name: 'type.coffee'})).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(
      client.tags.update({id: tag.id, name: 'cuisine.coffee'}),
    ).rejects.toMatchObject({code: 'CONFLICT'});
    expect(await client.tags.get({id: tag.id})).toMatchObject({
      name: 'type.coffee',
      namespaceId: type.id,
    });
    await expect(client.namespaces.delete({id: type.id})).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
    });
    await client.tags.delete({id: tag.id});
    await client.namespaces.delete({id: type.id});
  });

  it('force deletes a namespace while preserving tags and place associations', async () => {
    const namespace = await client.namespaces.create({name: 'type'});
    const cafe = await client.tags.create({
      name: 'type.cafe',
      icon: {emoji: '☕'},
      description: 'Coffee',
    });
    const bakery = await client.tags.create({name: 'type.bakery'});
    const other = await client.namespaces.create({name: 'other'});
    const unrelated = await client.tags.create({name: 'other.cafe'});
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: 'force-delete',
        name: 'Cafe',
        formattedAddress: 'NYC',
        coordinates: 'SRID=4326;POINT(-74 40)',
      })
      .returning();
    const assignment = await client.places.tag({
      placeId: place!.id,
      tag: cafe.name,
      notes: 'Espresso',
    });

    expect(await client.namespaces.delete({id: namespace.id, force: true})).toEqual(
      namespace,
    );
    await expect(client.namespaces.get({id: namespace.id})).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(await client.tags.get({id: cafe.id})).toMatchObject({
      ...cafe,
      name: 'cafe',
      namespaceId: null,
      updatedAt: expect.any(Date),
    });
    expect(await client.tags.get({id: bakery.id})).toMatchObject({
      name: 'bakery',
      namespaceId: null,
    });
    expect(await client.tags.get({id: unrelated.id})).toEqual(unrelated);
    expect(await client.namespaces.get({id: other.id})).toEqual(other);
    const matches = await client.places.list({query: 'tag[cafe]'});
    expect(matches[0]!.tags).toEqual([
      expect.objectContaining({
        ...assignment,
        tag: expect.objectContaining({id: cafe.id, name: 'cafe'}),
      }),
    ]);
  });

  it('rolls back the entire force deletion when any bare tag name collides', async () => {
    const namespace = await client.namespaces.create({name: 'type'});
    await client.tags.create({name: 'type.bakery'});
    await client.tags.create({name: 'type.cafe'});
    await client.tags.create({name: 'cafe'});
    const before = await client.tags.list();

    await expect(
      client.namespaces.delete({id: namespace.id, force: true}),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: 'Cannot unlink tags: a bare tag name already exists',
    });
    expect(await client.namespaces.get({id: namespace.id})).toEqual(namespace);
    expect(await client.tags.list()).toEqual(before);
  });

  it('force deletes empty namespaces and reports missing ones', async () => {
    const namespace = await client.namespaces.create({name: 'empty'});
    expect(await client.namespaces.delete({id: namespace.id, force: true})).toEqual(
      namespace,
    );
    await expect(
      client.namespaces.delete({id: namespace.id, force: true}),
    ).rejects.toMatchObject({code: 'NOT_FOUND'});
  });

  it('requires explicitly created namespaces', async () => {
    const tag = await client.tags.create({name: 'cafe'});
    await expect(client.tags.create({name: 'missing.cafe'})).rejects.toMatchObject({
      code: 'NAMESPACE_NOT_FOUND',
      status: 404,
    });
    await expect(
      client.tags.update({id: tag.id, name: 'missing.cafe'}),
    ).rejects.toMatchObject({code: 'NAMESPACE_NOT_FOUND'});
    expect(await client.namespaces.list()).toEqual([]);
    expect(await client.tags.get({id: tag.id})).toEqual(tag);
  });

  it.each(['.cafe', 'type.', 'type.cafe.bar', 'type. cafe', 'type .cafe'])(
    'rejects malformed qualified names: %s',
    async name => {
      await expect(client.tags.create({name})).rejects.toMatchObject({status: 400});
      const tag = await client.tags.create({name: 'cafe'});
      await expect(client.tags.update({id: tag.id, name})).rejects.toMatchObject({
        status: 400,
      });
    },
  );

  it('renames namespace prefixes atomically and preserves place assignments', async () => {
    const namespace = await client.namespaces.create({name: 'type'});
    const cafe = await client.tags.create({name: 'type.cafe', icon: {emoji: '☕'}});
    const bakery = await client.tags.create({name: 'type.bakery'});
    const [place] = await db
      .insert(places)
      .values({
        googlePlaceId: 'namespace-place',
        name: 'Cafe',
        formattedAddress: 'NYC',
        coordinates: 'SRID=4326;POINT(-74 40)',
      })
      .returning();
    const assignment = await client.places.tag({
      placeId: place!.id,
      tag: cafe.name,
      notes: 'Espresso',
    });

    await client.namespaces.update({id: namespace.id, description: 'Place types'});
    expect(await client.tags.get({id: cafe.id})).toEqual(cafe);
    await client.namespaces.update({id: namespace.id, name: ' Category '});
    expect(await client.tags.get({id: cafe.id})).toMatchObject({
      id: cafe.id,
      name: 'category.cafe',
      namespaceId: namespace.id,
      icon: cafe.icon,
      createdAt: cafe.createdAt,
    });
    expect(await client.tags.get({id: bakery.id})).toMatchObject({
      name: 'category.bakery',
    });
    const matches = await client.places.list({query: 'tag[category.*]'});
    expect(matches).toHaveLength(1);
    expect(matches[0]!.tags).toEqual([
      expect.objectContaining({
        ...assignment,
        tag: expect.objectContaining({name: 'category.cafe'}),
      }),
    ]);
    expect(await client.places.list({query: 'tag[category.cafe]'})).toHaveLength(1);
    expect(await client.places.list({query: 'tag[type.*]'})).toEqual([]);
    await expect(
      client.places.tag({placeId: place!.id, tag: 'type.cafe'}),
    ).rejects.toMatchObject({code: 'NOT_FOUND'});
    await client.places.tag({placeId: place!.id, tag: 'category.cafe'});
    await client.tags.update({id: cafe.id, name: 'category.coffee'});
    expect(await client.places.list({query: 'tag[category.coffee]'})).toHaveLength(1);
    await client.namespaces.create({name: 'taken'});
    await expect(
      client.namespaces.update({id: namespace.id, name: 'taken'}),
    ).rejects.toMatchObject({code: 'CONFLICT'});
    expect(await client.tags.get({id: cafe.id})).toMatchObject({name: 'category.coffee'});
  });

  it('keeps prefixes consistent when namespace rename races with tag creation', async () => {
    const namespace = await client.namespaces.create({name: 'type'});
    const [renamed, created] = await Promise.allSettled([
      client.namespaces.update({id: namespace.id, name: 'category'}),
      client.tags.create({name: 'type.cafe'}),
    ]);
    expect(renamed.status).toBe('fulfilled');

    if (created.status === 'rejected') {
      expect(created.reason).toMatchObject({code: 'NAMESPACE_NOT_FOUND'});
    }

    for (const tag of await client.tags.list()) {
      expect(tag).toMatchObject({name: 'category.cafe', namespaceId: namespace.id});
    }
  });

  it('rejects concurrent duplicate qualified names', async () => {
    await client.namespaces.create({name: 'type'});
    const results = await Promise.allSettled([
      client.tags.create({name: 'type.cafe'}),
      client.tags.create({name: ' TYPE.CAFE '}),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({
      reason: {code: 'CONFLICT'},
    });
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
