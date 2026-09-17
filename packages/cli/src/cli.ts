import {merge, object, or} from '@optique/core/constructs';
import {message} from '@optique/core/message';
import {multiple, optional, withDefault} from '@optique/core/modifiers';
import type {InferValue} from '@optique/core/parser';
import {argument, command, constant, option} from '@optique/core/primitives';
import {string} from '@optique/core/valueparser';
import {zod} from '@optique/zod';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {importInput} from '@places/common/contract/place';
import {tag, tagIcon} from '@places/common/contract/tag';
import {z} from 'zod';

const id = argument(zod(tag.shape.id, {metavar: 'ID', placeholder: ''}), {
  description: message`Tag UUID, shown by tags list or tags create.`,
});
const name = argument(zod(tag.shape.name, {metavar: 'NAME', placeholder: ''}), {
  description: message`Tag name; trimmed and lowercased. Namespaces such as type:cafe are optional.`,
});

const tagMetadata = {
  icon: optional(
    option(
      '--icon',
      zod(z.union([z.literal(''), tagIcon.shape.emoji]), {
        metavar: 'EMOJI',
        placeholder: '',
      }),
      {
        description: message`Emoji icon for the tag. An empty string clears it.`,
      },
    ),
  ),
  description: optional(
    option('--description', string({metavar: 'TEXT'}), {
      description: message`Description of the tag. An empty string clears it.`,
    }),
  ),
};

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
  or(
    command(
      'import',
      object({
        action: constant('import'),
        notes: optional(
          option('--notes', string({metavar: 'TEXT'}), {
            description: message`Notes for the place. Replaces existing notes; an empty string clears them.`,
          }),
        ),
        tags: multiple(
          option('--tag', zod(tag.shape.name, {metavar: 'NAME_OR_ID', placeholder: ''}), {
            description: message`Existing tag name or UUID. Repeat to apply multiple tags.`,
          }),
        ),
        input: argument(zod(importInput, {metavar: 'INPUT', placeholder: ''}), {
          description: message`URL or provider reference to import. Currently supports Google Maps URLs and gmaps:<place_id>.`,
        }),
      }),
      {
        description: message`Import places from a supported URL or provider reference. Returns an import type and job ID.`,
      },
    ),
    command('list', object({action: constant('places-list')}), {
      description: message`List saved places, newest first.`,
    }),
    command(
      'import-status',
      object({
        action: constant('import-status'),
        jobId: argument(zod(z.uuid(), {metavar: 'JOB_ID', placeholder: ''})),
      }),
      {
        description: message`Show an import's status and resulting place IDs. Jobs are retained for seven days after completion.`,
      },
    ),
    command(
      'tags',
      or(
        command('list', object({action: constant('list')}), {
          description: message`List all tags sorted by name.`,
        }),
        command('get', object({action: constant('get'), id}), {
          description: message`Show a tag by ID.`,
        }),
        command('create', object({action: constant('create'), name, ...tagMetadata}), {
          description: message`Create a tag. Duplicate names are rejected.`,
        }),
        command(
          'update',
          object({
            action: constant('update'),
            id,
            name: optional(name),
            ...tagMetadata,
          }),
          {
            description: message`Update a tag's name, icon, or description, preserving its ID and place associations.`,
          },
        ),
        command('delete', object({action: constant('delete'), id}), {
          description: message`Delete a tag and its associations. Saved places are preserved.`,
        }),
      ),
      {description: message`Create, browse, update, and delete tags for saved places.`},
    ),
  ),
);

export function createClient(server: string): Client {
  return createORPCClient(new RPCLink({url: `${server.replace(/\/$/, '')}/rpc`}));
}

export function execute(args: InferValue<typeof parser>, client: Client) {
  switch (args.action) {
    case 'import':
      return client.places.import({
        input: args.input,
        tags: [...args.tags],
        notes: args.notes,
      });
    case 'places-list':
      return client.places.list();
    case 'import-status':
      return client.places.importStatus({jobId: args.jobId});
    case 'list':
      return client.tags.list();
    case 'get':
      return client.tags.get({id: args.id});
    case 'create':
      return client.tags.create({
        name: args.name,
        icon: iconPayload(args.icon),
        description: args.description === '' ? null : args.description,
      });
    case 'update':
      return updateTag(args, client);
    case 'delete':
      return client.tags.delete({id: args.id});
  }
}

function updateTag(
  args: Extract<InferValue<typeof parser>, {action: 'update'}>,
  client: Client,
) {
  if (
    args.name === undefined &&
    args.icon === undefined &&
    args.description === undefined
  ) {
    throw new Error('Provide a name, --icon, or --description.');
  }

  return client.tags.update({
    id: args.id,
    name: args.name,
    icon: iconPayload(args.icon),
    description: args.description === '' ? null : args.description,
  });
}

function iconPayload(emoji: string | undefined) {
  if (emoji === '') {
    return null;
  }

  return emoji === undefined ? undefined : {emoji};
}
