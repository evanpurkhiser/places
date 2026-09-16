import {serve} from '@hono/node-server';

import {createApp} from './app.ts';
import {loadConfig} from './config.ts';
import {createDatabase} from './db/index.ts';

const config = await loadConfig();
const db = createDatabase(config.database.url);
const server = serve(
  {
    fetch: createApp({db, config}).fetch,
    hostname: config.server.host,
    port: config.server.port,
  },
  info => {
    console.log(`Places API listening on http://${info.address}:${info.port}`);
  },
);

function shutdown() {
  server.close(() => {
    void db.$client.end();
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
