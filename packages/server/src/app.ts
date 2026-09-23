import {RPCHandler} from '@orpc/server/fetch';
import {Hono} from 'hono';

import {api} from './api/index.ts';
import type {Context} from './context.ts';
import {router} from './rpc/index.ts';

export function createApp(context: Context) {
  const app = new Hono<{Variables: Context}>();
  const rpc = new RPCHandler(router);

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

  return app;
}
