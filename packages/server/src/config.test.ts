import {expect, it} from 'vitest';

import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {configSchema, loadConfig} from './config.ts';
import {testConfig} from './fixtures/config.ts';

it('does not include secrets from malformed YAML in loader errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'places-config-'));
  const path = join(directory, 'config.yaml');

  try {
    await writeFile(path, 'google:\n  apiKey: "sentinel-secret\n');
    await expect(loadConfig(['--config', path])).rejects.toThrow();
    await expect(loadConfig(['--config', path])).rejects.not.toThrow('sentinel-secret');
  } finally {
    await rm(directory, {recursive: true});
  }
});

it.each([0, 80, 443, 3000, 5188, 65535])('accepts valid TCP port %i', port => {
  expect(
    configSchema.parse({
      ...testConfig,
      server: {port},
      database: {url: 'postgres://localhost/places'},
    }).server.port,
  ).toBe(port);
});

it.each([-1, 65536, 1.5])('rejects invalid TCP port %i', port => {
  expect(
    configSchema.safeParse({
      ...testConfig,
      server: {port},
      database: {url: 'postgres://localhost/places'},
    }).success,
  ).toBe(false);
});

it('defaults to a loopback server and requires a PostgreSQL URL', () => {
  expect(
    configSchema.parse({...testConfig, database: {url: 'postgres://localhost/places'}})
      .server,
  ).toEqual({host: '127.0.0.1', port: 5188});
  expect(
    configSchema.safeParse({...testConfig, database: {url: 'https://example.com'}})
      .success,
  ).toBe(false);
  expect(configSchema.safeParse({...testConfig}).success).toBe(false);
  expect(
    configSchema.safeParse({
      ...testConfig,
      database: {url: 'postgres://localhost/places'},
      typo: true,
    }).success,
  ).toBe(false);
});

it('defaults worker settings independently and supports partial overrides', () => {
  const database = {url: 'postgres://localhost/places'};
  expect(
    configSchema.parse({
      ...testConfig,
      database,
      workers: {'instagram-import': {batchSize: 3}},
    }).workers['instagram-import'],
  ).toEqual({batchSize: 3, concurrency: 1});
  expect(configSchema.parse({...testConfig, database}).workers).toEqual({
    'instagram-import': {batchSize: 1, concurrency: 1},
    'gmaps-import': {batchSize: 1, concurrency: 1},
    'gmaps-sync': {batchSize: 1, concurrency: 1},
  });
  expect(
    configSchema.parse({...testConfig, database, workers: {'gmaps-sync': {batchSize: 3}}})
      .workers,
  ).toEqual({
    'instagram-import': {batchSize: 1, concurrency: 1},
    'gmaps-import': {batchSize: 1, concurrency: 1},
    'gmaps-sync': {batchSize: 3, concurrency: 1},
  });
});

it.each([0, -1, 1.5, '8'])('rejects invalid worker size %s', value => {
  for (const queue of ['gmaps-import', 'gmaps-sync', 'instagram-import']) {
    for (const field of ['batchSize', 'concurrency']) {
      expect(
        configSchema.safeParse({
          ...testConfig,
          database: {url: 'postgres://localhost/places'},
          workers: {[queue]: {[field]: value}},
        }).success,
      ).toBe(false);
    }
  }
});

it('requires explicit Instagram capture and automatic-tag configuration', () => {
  const database = {url: 'postgres://localhost/places'};
  expect(configSchema.safeParse({...testConfig, database, instagram: {}}).success).toBe(
    false,
  );
  const instagram = {
    alwaysApplyTags: ['status.needs-review'],
    requiredNamespaces: ['type'],
    excludedNamespaces: ['rating'],
    excludedTags: ['favorite'],
    capture: {model: 'test'},
  };
  expect(
    configSchema.parse({...testConfig, database, instagram}).instagram,
  ).toMatchObject(instagram);
  expect(
    configSchema.parse({
      ...testConfig,
      database,
      instagram: {...instagram, alwaysApplyTags: []},
    }).instagram.alwaysApplyTags,
  ).toEqual([]);
  expect(
    configSchema.safeParse({
      ...testConfig,
      database,
      instagram: {...instagram, excludedTags: undefined},
    }).success,
  ).toBe(false);
});

it('requires Instagram settings and a shared OpenAI key', () => {
  const database = {url: 'postgres://localhost/places'};
  const config = configSchema.parse({...testConfig, database});
  expect(config.openai.key).toBe('test');
  for (const override of [
    {instagram: undefined},
    {openai: undefined},
    {openai: {}},
    {openai: {key: '  '}},
  ]) {
    expect(configSchema.safeParse({...testConfig, database, ...override}).success).toBe(
      false,
    );
  }
});
