import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import {RPCHandler} from '@orpc/server/fetch';
import type {Client} from '@places/common/contract';
import {expect, it} from 'vitest';

import {placeFilterEngine} from '../filter-engine/index.ts';

import {queryRouter} from './query.ts';

it('serves serializable documentation for the registered query capabilities', async () => {
  const handler = new RPCHandler({query: queryRouter});
  const client: Client = createORPCClient(
    new RPCLink({
      url: 'http://localhost/rpc',
      fetch: async request => {
        const {response} = await handler.handle(request, {prefix: '/rpc'});
        return response ?? new Response(null, {status: 404});
      },
    }),
  );
  const documentation = await client.query.describe();

  expect(documentation).toEqual(placeFilterEngine.describe());
  expect(documentation.filters.map(filter => filter.name)).toEqual([
    'tag',
    'name',
    'address',
    'notes',
    'has',
  ]);
  expect(documentation.functions).toEqual([]);

  for (const filter of documentation.filters) {
    expect(filter.description).not.toBe('');
    expect(filter.examples.length).toBeGreaterThan(0);

    for (const example of filter.examples) {
      expect(() => placeFilterEngine.prepare(example.query)).not.toThrow();
    }
  }
});
