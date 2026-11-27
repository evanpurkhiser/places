import {xdgConfig} from 'xdg-basedir';
import {parse} from 'yaml';
import {z} from 'zod';

import {readFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';

export const serverUrl = z.url({protocol: /^https?$/});

const configSchema = z.strictObject({
  server: serverUrl.default('http://127.0.0.1:5188'),
  token_file: z.string().min(1).optional(),
});

export function defaultConfigPath() {
  if (!xdgConfig) {
    throw new Error('Cannot determine the config directory; specify --config.');
  }

  return join(xdgConfig, 'places', 'config.yaml');
}

interface Config {
  server: string;
  token?: string;
}

export async function loadConfig(
  options: {config?: string; server?: string} = {},
): Promise<Config> {
  const path = options.config ?? defaultConfigPath();
  let contents: string;

  try {
    contents = await readFile(path, 'utf8');
  } catch (error) {
    if (
      options.config === undefined &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      const {server} = configSchema.parse({server: options.server});
      return {server};
    }

    throw new Error(`Cannot read CLI config at ${path}`, {cause: error});
  }

  try {
    const config = configSchema.parse(parse(contents, {prettyErrors: false}) ?? {});

    const server = serverUrl.parse(options.server ?? config.server);

    if (!config.token_file) {
      return {server};
    }

    const tokenPath = resolve(dirname(path), config.token_file);
    const tokenContents = await readFile(tokenPath, 'utf8');
    const token = tokenContents.trim();

    if (!/^[A-Za-z0-9_-]+$/.test(token)) {
      throw new Error(`Invalid bearer token in ${tokenPath}`);
    }

    return {server, token};
  } catch (error) {
    throw new Error(
      `Invalid CLI config at ${path}: ${error instanceof Error ? error.message : 'Invalid YAML'}`,
      {cause: error},
    );
  }
}
