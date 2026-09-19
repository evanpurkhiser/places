import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';

import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import type * as Config from './config.ts';

describe('CLI config', () => {
  let directory: string;
  let defaultConfigPath: typeof Config.defaultConfigPath;
  let loadConfig: typeof Config.loadConfig;

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'places-cli-'));
    vi.stubEnv('XDG_CONFIG_HOME', directory);
    await mkdir(join(directory, 'places'));
    ({defaultConfigPath, loadConfig} = await import('./config.ts'));
  });

  afterEach(async () => {
    await rm(defaultConfigPath(), {force: true});
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(directory, {recursive: true, force: true});
  });

  it('uses localhost when the default file is missing', async () => {
    await expect(loadConfig()).resolves.toEqual({server: 'http://127.0.0.1:5188'});
  });

  it('reads the XDG config and lets flags override it', async () => {
    await writeFile(defaultConfigPath(), 'server: https://places.example.com\n');
    await expect(loadConfig()).resolves.toEqual({server: 'https://places.example.com'});
    await expect(loadConfig({server: 'http://localhost:6000'})).resolves.toEqual({
      server: 'http://localhost:6000',
    });
  });

  it('reads an explicit config file', async () => {
    const config = join(directory, 'custom.yaml');
    await writeFile(config, 'server: https://custom.example.com\n');
    await expect(loadConfig({config})).resolves.toEqual({
      server: 'https://custom.example.com',
    });
  });

  it('rejects a missing explicit file', async () => {
    await expect(loadConfig({config: join(directory, 'missing.yaml')})).rejects.toThrow(
      'Cannot read CLI config',
    );
  });

  it.each(['server: file:///tmp/places', 'unexpected: true', 'server: ['])(
    'rejects invalid config: %s',
    async contents => {
      await writeFile(defaultConfigPath(), contents);
      await expect(loadConfig()).rejects.toThrow('Invalid CLI config');
    },
  );
});
