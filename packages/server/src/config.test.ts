import {expect, it} from 'vitest';

import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {configSchema, loadConfig} from './config.ts';

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
    configSchema.parse({server: {port}, database: {url: 'postgres://localhost/places'}})
      .server.port,
  ).toBe(port);
});

it.each([-1, 65536, 1.5])('rejects invalid TCP port %i', port => {
  expect(
    configSchema.safeParse({
      server: {port},
      database: {url: 'postgres://localhost/places'},
    }).success,
  ).toBe(false);
});

it('defaults to a loopback server and requires a PostgreSQL URL', () => {
  expect(
    configSchema.parse({database: {url: 'postgres://localhost/places'}}).server,
  ).toEqual({host: '127.0.0.1', port: 5188});
  expect(configSchema.safeParse({database: {url: 'https://example.com'}}).success).toBe(
    false,
  );
  expect(configSchema.safeParse({}).success).toBe(false);
  expect(
    configSchema.safeParse({database: {url: 'postgres://localhost/places'}, typo: true})
      .success,
  ).toBe(false);
});
