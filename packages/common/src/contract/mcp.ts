import {mcp} from 'orpc-mcp';

const readOnly = {readOnlyHint: true} as const;
const externalRead = {readOnlyHint: true, openWorldHint: true} as const;
const write = {destructiveHint: false} as const;
const destructive = {destructiveHint: true} as const;

export const mcpTools = {
  namespaces: {
    list: mcp.tool({
      name: 'namespaces_list',
      description: 'List tag namespaces.',
      annotations: readOnly,
    }),
    get: mcp.tool({
      name: 'namespaces_get',
      description: 'Get a tag namespace by ID.',
      annotations: readOnly,
    }),
    create: mcp.tool({
      name: 'namespaces_create',
      description: 'Create a tag namespace.',
      annotations: write,
    }),
    update: mcp.tool({
      name: 'namespaces_update',
      description: 'Update the name, icon, or description of a tag namespace.',
      annotations: {...write, idempotentHint: true},
    }),
    delete: mcp.tool({
      name: 'namespaces_delete',
      description:
        'Delete a tag namespace. Force deletion unlinks its tags and removes their namespace prefixes.',
      annotations: destructive,
    }),
  },
  tags: {
    list: mcp.tool({
      name: 'tags_list',
      description: 'List active tags.',
      annotations: readOnly,
    }),
    get: mcp.tool({
      name: 'tags_get',
      description: 'Get a tag by ID.',
      annotations: readOnly,
    }),
    create: mcp.tool({
      name: 'tags_create',
      description: 'Create a tag.',
      annotations: write,
    }),
    update: mcp.tool({
      name: 'tags_update',
      description: 'Update the name, icon, description, or archived state of a tag.',
      annotations: {...write, idempotentHint: true},
    }),
    delete: mcp.tool({
      name: 'tags_delete',
      description: 'Delete a tag and its assignments. Saved places are preserved.',
      annotations: destructive,
    }),
  },
  places: {
    searchGoogle: mcp.tool({
      name: 'places_search_google',
      description: 'Search Google Maps for places that can be imported.',
      annotations: externalRead,
    }),
    tag: mcp.tool({
      name: 'places_tag',
      description: 'Apply a tag to a saved place, optionally setting an assignment note.',
      annotations: {...write, idempotentHint: true},
    }),
    untag: mcp.tool({
      name: 'places_untag',
      description: 'Remove a tag and its assignment note from a saved place.',
      annotations: {...destructive, idempotentHint: true},
    }),
    list: mcp.tool({
      name: 'places_list',
      description: 'List saved places, optionally filtering and sorting them.',
      annotations: externalRead,
    }),
    syncStatus: mcp.tool({
      name: 'places_sync_status',
      description: 'Get the status and result of a place sync job.',
      annotations: readOnly,
    }),
    import: mcp.tool({
      name: 'places_import',
      description: 'Queue a place import from a Google Maps or Instagram input.',
      annotations: {...write, openWorldHint: true},
    }),
    getImportRun: mcp.tool({
      name: 'places_get_import_run',
      description: 'Get an import run by job ID.',
      annotations: readOnly,
    }),
    listImportRuns: mcp.tool({
      name: 'places_list_import_runs',
      description: 'List recent import runs.',
      annotations: readOnly,
    }),
  },
  query: {
    describe: mcp.tool({
      name: 'query_describe',
      description:
        'Describe the filters, functions, values, and examples in the place query language.',
      annotations: readOnly,
    }),
  },
} as const;
