import {xdgConfig} from 'xdg-basedir';
import {parse} from 'yaml';
import {z} from 'zod';

import {readFile} from 'node:fs/promises';
import {join} from 'node:path';

export const serverUrl = z.url({protocol: /^https?$/});

const configSchema = z.strictObject({
  server: serverUrl.default('http://127.0.0.1:5188'),
});

export function defaultConfigPath() {
  if (!xdgConfig) {
    throw new Error('Cannot determine the config directory; specify --config.');
  }

  return join(xdgConfig, 'places', 'config.yaml');
}

export async function loadConfig(options: {config?: string; server?: string} = {}) {
  const path = options.config ?? defaultConfigPath();
  let contents: string;

  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if (
      options.config === undefined &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return configSchema.parse({server: options.server});
    }

    throw new Error(`Cannot read CLI config at ${path}`, {cause: error});
  }

  try {
    const config = configSchema.parse(parse(contents, {prettyErrors: false}) ?? {});

    return configSchema.parse({
      ...config,
      ...(options.server ? {server: options.server} : {}),
    });
  } catch (error) {
    throw new Error(
      `Invalid CLI config at ${path}: ${error instanceof Error ? error.message : 'Invalid YAML'}`,
      {cause: error},
    );
  }
}
