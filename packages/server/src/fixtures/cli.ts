import {serve} from '@hono/node-server';

import {execFile} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../../../cli/src/main.ts', import.meta.url));

export async function withPlacesCli(
  {
    fetch,
    port,
    prefix = [],
  }: {fetch: Parameters<typeof serve>[0]['fetch']; port: number; prefix?: string[]},
  exercise: (cli: ReturnType<typeof connectCli>) => Promise<void>,
) {
  const server = serve({fetch, hostname: '127.0.0.1', port});
  try {
    if (!server.listening) {
      await once(server, 'listening');
    }
    await exercise(connectCli(port, prefix));
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
  }
}

function connectCli(port: number, prefix: string[]) {
  const run = (...args: string[]) =>
    exec(process.execPath, [
      cliPath,
      '--server',
      `http://127.0.0.1:${port}`,
      ...prefix,
      ...args,
    ]);
  return {
    run,
    async json(...args: string[]) {
      const {stdout} = await run(...args);
      return JSON.parse(stdout);
    },
  };
}
