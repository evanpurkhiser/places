import {merge, object, or} from '@optique/core/constructs';
import {withDefault} from '@optique/core/modifiers';
import type {InferValue} from '@optique/core/parser';
import {argument, command, constant, option} from '@optique/core/primitives';
import {zod} from '@optique/zod';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {tag} from '@places/common/contract/tag';
import {z} from 'zod';

const id = argument(zod(tag.shape.id, {metavar: 'ID', placeholder: ''}));
const name = argument(zod(tag.shape.name, {metavar: 'NAME', placeholder: ''}));

export const parser = merge(
  object({
    server: withDefault(
      option('--server', zod(z.url({protocol: /^https?$/}), {placeholder: ''})),
      'http://127.0.0.1:5188',
    ),
  }),
  command(
    'tags',
    or(
      command('list', object({action: constant('list')})),
      command('get', object({action: constant('get'), id})),
      command('create', object({action: constant('create'), name})),
      command('update', object({action: constant('update'), id, name})),
      command('delete', object({action: constant('delete'), id})),
    ),
  ),
);

export function createClient(server: string): Client {
  return createORPCClient(new RPCLink({url: `${server.replace(/\/$/, '')}/rpc`}));
}

export function execute(args: InferValue<typeof parser>, client: Client) {
  switch (args.action) {
    case 'list':
      return client.tags.list();
    case 'get':
      return client.tags.get({id: args.id});
    case 'create':
      return client.tags.create({name: args.name});
    case 'update':
      return client.tags.update({id: args.id, name: args.name});
    case 'delete':
      return client.tags.delete({id: args.id});
  }
}
