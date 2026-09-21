import {merge, object, or, seq} from '@optique/core/constructs';
import {message} from '@optique/core/message';
import {multiple, optional} from '@optique/core/modifiers';
import type {InferValue} from '@optique/core/parser';
import {argument, command, constant, option} from '@optique/core/primitives';
import {string} from '@optique/core/valueparser';
import {zod} from '@optique/zod';
import {createORPCClient} from '@orpc/client';
import {RPCLink} from '@orpc/client/fetch';
import type {Client} from '@places/common/contract';
import {namespace} from '@places/common/contract/namespace';
import {googleSearchQuery, importInput, place} from '@places/common/contract/place';
import {tag, tagIcon, tagReference} from '@places/common/contract/tag';
import {z} from 'zod';

import {serverUrl} from './config.ts';
import {formatFilterDocs} from './filter-docs.ts';

const id = argument(zod(tag.shape.id, {metavar: 'ID', placeholder: ''}), {
  description: message`Tag UUID, shown by tags list or tags create.`,
});
const name = argument(zod(tag.shape.name, {metavar: 'NAME', placeholder: ''}), {
  description: message`Tag name or namespace.tag; trimmed and lowercased. The namespace must exist.`,
});

const assignmentArguments = {
  placeId: argument(zod(place.shape.id, {metavar: 'PLACE_ID', placeholder: ''}), {
    description: message`Saved place UUID, shown by list or import-status.`,
  }),
  tag: argument(zod(tagReference, {metavar: 'NAME_OR_ID', placeholder: ''}), {
    description: message`Existing tag name or UUID.`,
  }),
};

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

const namespaceId = argument(zod(namespace.shape.id, {metavar: 'ID', placeholder: ''}), {
  description: message`Namespace UUID, shown by namespace list or namespace create.`,
});
const namespaceName = argument(
  zod(namespace.shape.name, {metavar: 'NAME', placeholder: ''}),
  {
    description: message`Namespace name; trimmed and lowercased. Colons are reserved.`,
  },
);

const namespaceMetadata = {
  icon: optional(
    option(
      '--icon',
      zod(z.union([z.literal(''), tagIcon.shape.emoji]), {
        metavar: 'EMOJI',
        placeholder: '',
      }),
      {
        description: message`Emoji icon for the namespace. An empty string clears it.`,
      },
    ),
  ),
  description: optional(
    option('--description', string({metavar: 'TEXT'}), {
      description: message`Description of the namespace. An empty string clears it.`,
    }),
  ),
};

export const parser = merge(
  object({
    config: optional(
      option('--config', string({metavar: 'PATH'}), {
        description: message`Path to the CLI YAML config.`,
      }),
    ),
    server: optional(
      option('--server', zod(serverUrl, {metavar: 'URL', placeholder: ''}), {
        description: message`Places server URL; overrides the CLI config.`,
      }),
    ),
  }),
  or(
    command(
      'search-gmaps',
      object({
        action: constant('search-gmaps'),
        query: argument(zod(googleSearchQuery, {metavar: 'QUERY', placeholder: ''}), {
          description: message`Keywords to search for; include a city or neighborhood.`,
        }),
      }),
      {description: message`Search Google Maps for places to add to Places.`},
    ),
    command(
      'docs',
      command('filter', object({action: constant('docs-filter')}), {
        description: message`Print the server's available filters, functions, types, and examples.`,
      }),
      {description: message`Read documentation from the Places server.`},
    ),
    command(
      'import',
      object({
        action: constant('import'),
        wait: option('--wait', {
          description: message`Wait for completion and return the import status with saved place IDs.`,
        }),
        notes: optional(
          option('--notes', string({metavar: 'TEXT'}), {
            description: message`Notes for the place. Replaces existing notes; an empty string clears them.`,
          }),
        ),
        tags: multiple(
          option('--tag', zod(tagReference, {metavar: 'NAME_OR_ID', placeholder: ''}), {
            description: message`Existing tag name or UUID. Repeat to apply multiple tags.`,
          }),
        ),
        tagNotes: multiple(
          seq(
            option(
              '--tag-note',
              zod(tagReference, {metavar: 'NAME_OR_ID', placeholder: ''}),
              {
                description: message`Apply an existing tag with a note. Repeat for multiple tags; an empty note clears it.`,
              },
            ),
            argument(string({metavar: 'NOTE'}), {
              description: message`Note for the preceding --tag-note tag. An empty string clears it.`,
            }),
          ),
        ),
        input: argument(zod(importInput, {metavar: 'INPUT', placeholder: ''}), {
          description: message`URL or provider reference to import. Supports Google Maps URLs, gmaps:<place_id>, and Instagram post or reel URLs.`,
        }),
      }),
      {
        description: message`Import places from a supported URL or provider reference. Returns an import type and job ID.`,
      },
    ),
    command(
      'tag',
      object({
        action: constant('place-tag'),
        ...assignmentArguments,
        notes: optional(
          option('--notes', string({metavar: 'TEXT'}), {
            description: message`Note for this tag assignment. Omit to preserve it; an empty string clears it.`,
          }),
        ),
      }),
      {description: message`Apply a tag to a saved place, optionally updating its note.`},
    ),
    command(
      'untag',
      object({
        action: constant('place-untag'),
        ...assignmentArguments,
      }),
      {description: message`Remove a tag and its assignment note from a saved place.`},
    ),
    command(
      'list',
      object({
        action: constant('places-list'),
        query: optional(
          option('--query', string({metavar: 'QUERY'}), {
            description: message`Filter places using tags, notes, and boolean expressions.`,
          }),
        ),
      }),
      {description: message`List saved places, newest first.`},
    ),
    command(
      'sync',
      object({
        action: constant('sync'),
        query: optional(
          option('--query', string({metavar: 'QUERY'}), {
            description: message`Sync only places matching this filter query.`,
          }),
        ),
      }),
      {
        description: message`Queue a Google refresh for every matching saved place; defaults to all places.`,
      },
    ),
    command(
      'sync-status',
      object({
        action: constant('sync-status'),
        jobId: argument(zod(z.uuid(), {metavar: 'JOB_ID', placeholder: ''})),
      }),
      {description: message`Show a sync job's status and result.`},
    ),
    command(
      'import-status',
      object({
        action: constant('import-status'),
        jobId: argument(zod(z.uuid(), {metavar: 'JOB_ID', placeholder: ''})),
      }),
      {
        description: message`Show an import's recorded status and resulting place IDs, including after queue cleanup.`,
      },
    ),
    command(
      'namespace',
      or(
        command('list', object({action: constant('namespace-list')}), {
          description: message`List all namespaces sorted by name.`,
        }),
        command('get', object({action: constant('namespace-get'), id: namespaceId}), {
          description: message`Show a namespace by ID.`,
        }),
        command(
          'create',
          object({
            action: constant('namespace-create'),
            name: namespaceName,
            ...namespaceMetadata,
          }),
          {
            description: message`Create a namespace. Duplicate names are rejected.`,
          },
        ),
        command(
          'update',
          object({
            action: constant('namespace-update'),
            id: namespaceId,
            name: optional(namespaceName),
            ...namespaceMetadata,
          }),
          {
            description: message`Update a namespace's name, icon, or description, preserving its ID.`,
          },
        ),
        command(
          'delete',
          object({
            action: constant('namespace-delete'),
            id: namespaceId,
            force: option('--force', {
              description: message`Unlink tags and remove their namespace prefixes. Name collisions leave everything unchanged.`,
            }),
          }),
          {
            description: message`Delete a namespace.`,
          },
        ),
      ),
      {
        aliases: ['ns'],
        description: message`Create, browse, update, and delete tag namespaces.`,
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
    case 'search-gmaps':
      return client.places.searchGoogle({query: args.query});
    case 'docs-filter':
      return client.query.describe().then(formatFilterDocs);
    case 'import': {
      const pending = client.places.import({
        input: args.input,
        tags: [
          ...args.tags.map(tag => ({tag})),
          ...args.tagNotes.map(([tag, note]) => ({tag, note})),
        ],
        notes: args.notes,
      });

      return args.wait
        ? pending.then(({jobId}) => waitForImport(jobId, client))
        : pending;
    }
    case 'place-tag':
      return client.places.tag({placeId: args.placeId, tag: args.tag, notes: args.notes});
    case 'place-untag':
      return client.places.untag({placeId: args.placeId, tag: args.tag});
    case 'places-list':
      return args.query === undefined
        ? client.places.list()
        : client.places.list({query: args.query});
    case 'sync':
      return client.places.sync({query: args.query});
    case 'sync-status':
      return client.places.syncStatus({jobId: args.jobId});
    case 'import-status':
      return client.places.importStatus({jobId: args.jobId});
    case 'namespace-list':
      return client.namespaces.list();
    case 'namespace-get':
      return client.namespaces.get({id: args.id});
    case 'namespace-create':
      return client.namespaces.create({
        name: args.name,
        icon: iconPayload(args.icon),
        description: args.description === '' ? null : args.description,
      });
    case 'namespace-update':
      return updateNamespace(args, client);
    case 'namespace-delete':
      return client.namespaces.delete({id: args.id, force: args.force});
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

async function waitForImport(jobId: string, client: Client) {
  while (true) {
    const status = await client.places.importStatus({jobId});

    if (status.state === 'completed') {
      return status;
    }

    if (status.state === 'failed' || status.state === 'cancelled') {
      throw new Error(`Import ${jobId} ${status.state}. ${status.error ?? ''}`.trim());
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
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

function updateNamespace(
  args: Extract<InferValue<typeof parser>, {action: 'namespace-update'}>,
  client: Client,
) {
  if (
    args.name === undefined &&
    args.icon === undefined &&
    args.description === undefined
  ) {
    throw new Error('Provide a name, --icon, or --description.');
  }

  return client.namespaces.update({
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
