import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import {createTanstackQueryUtils} from '@orpc/tanstack-query';
import type {Client} from '@places/common/contract';

export type Place = Awaited<ReturnType<Client['places']['list']>>[number];

const client: Client = createORPCClient(
  new RPCLink({
    url: new URL('/rpc', window.location.origin),
  }),
);

export const rpc = createTanstackQueryUtils(client);
