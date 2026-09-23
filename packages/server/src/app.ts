import {serveStatic} from '@hono/node-server/serve-static';
import {RPCHandler} from '@orpc/server/fetch';
import {Hono} from 'hono';

import {fileURLToPath} from 'node:url';

import {api} from './api/index.ts';
import type {Context} from './context.ts';
import {router} from './rpc/index.ts';

const defaultWebRoot = fileURLToPath(new URL('../../web/dist/', import.meta.url));

interface AppOptions {
  webRoot?: string;
}

export function createApp(context: Context, options: AppOptions = {}) {
  const app = new Hono<{Variables: Context}>();
  const rpc = new RPCHandler(router);
  const webRoot = options.webRoot ?? defaultWebRoot;

  app.use('*', async (c, next) => {
    c.set('config', context.config);
    c.set('db', context.db);
    c.set('jobs', context.jobs);
    c.set('google', context.google);
    await next();
  });

  app.get('/health', c => c.json({status: 'ok'}));
  app.route('/api', api);
  app.use('/rpc/*', async (c, next) => {
    const {matched, response} = await rpc.handle(c.req.raw, {
      prefix: '/rpc',
      context: c.var,
    });

    if (matched) {
      return response;
    }

    return next();
  });

  app.use('/assets/*', async (c, next) => {
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    await next();
  });
  app.use('/assets/*', serveStatic({root: webRoot}));
  app.get('/', async (c, next) => {
    c.header('Cache-Control', 'no-cache');
    await next();
  });
  app.get('/', serveStatic({path: `${webRoot}/index.html`}));

  return app;
}
