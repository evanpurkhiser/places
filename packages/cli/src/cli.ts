import {merge, object, or} from '@optique/core/constructs';
import {message} from '@optique/core/message';
import {withDefault} from '@optique/core/modifiers';
import type {InferValue} from '@optique/core/parser';
import {argument, command, constant, option} from '@optique/core/primitives';
import {zod} from '@optique/zod';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {tag} from '@places/common/contract/tag';
import {z} from 'zod';

const id = argument(zod(tag.shape.id, {metavar: 'ID', placeholder: ''}), {
  description: message`Tag UUID, shown by tags list or tags create.`,
});
const name = argument(zod(tag.shape.name, {metavar: 'NAME', placeholder: ''}), {
  description: message`Tag name; trimmed and lowercased. Namespaces such as type:cafe are optional.`,
});

export const parser = merge(
  object({
    server: withDefault(
      option(
        '--server',
        zod(z.url({protocol: /^https?$/}), {metavar: 'URL', placeholder: ''}),
        {
          description: message`Places server URL (default: http://127.0.0.1:5188).`,
        },
      ),
      'http://127.0.0.1:5188',
    ),
  }),
  command(
    'tags',
    or(
      command('list', object({action: constant('list')}), {
        description: message`List all tags sorted by name.`,
      }),
      command('get', object({action: constant('get'), id}), {
        description: message`Show a tag by ID.`,
      }),
      command('create', object({action: constant('create'), name}), {
        description: message`Create a tag. Duplicate names are rejected.`,
      }),
      command('update', object({action: constant('update'), id, name}), {
        description: message`Rename a tag, preserving its ID and place associations.`,
      }),
      command('delete', object({action: constant('delete'), id}), {
        description: message`Delete a tag and its associations. Saved places are preserved.`,
      }),
    ),
    {description: message`Create, browse, rename, and delete tags for saved places.`},
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
