import {afterEach, describe, expect, it} from 'vitest';
import {z} from 'zod';

import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {createApp} from './app.ts';
import type {Context} from './context.ts';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => rm(directory, {recursive: true, force: true})),
  );
});

async function createWebRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'places-web-'));
  temporaryDirectories.push(root);

  await mkdir(path.join(root, 'assets'));
  await Promise.all([
    writeFile(path.join(root, 'index.html'), '<h1>Places</h1>'),
    writeFile(path.join(root, 'assets', 'app.js'), 'console.log("Places")'),
  ]);

  return root;
}

describe('web app', () => {
  it('serves the app at the root', async () => {
    const webRoot = await createWebRoot();
    const app = createApp({} as Context, {webRoot});
    const response = await app.request('/');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
    await expect(response.text()).resolves.toBe('<h1>Places</h1>');
  });

  it('caches built assets indefinitely', async () => {
    const webRoot = await createWebRoot();
    const app = createApp({} as Context, {webRoot});
    const response = await app.request('/assets/app.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable',
    );
  });
});

describe('MCP endpoint', () => {
  const post = (app: ReturnType<typeof createApp>, body: unknown) =>
    app.request('/mcp', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    });

  it('publishes the centralized tool catalog', async () => {
    const app = createApp({} as Context);
    const response = await post(app, {jsonrpc: '2.0', id: 1, method: 'tools/list'});
    const body = z
      .object({
        result: z.object({
          tools: z.array(
            z.object({
              name: z.string(),
              inputSchema: z.object({
                properties: z.record(z.string(), z.unknown()).default({}),
              }),
              outputSchema: z
                .object({
                  properties: z.record(z.string(), z.unknown()),
                })
                .optional(),
              annotations: z
                .object({
                  readOnlyHint: z.boolean().optional(),
                  destructiveHint: z.boolean().optional(),
                })
                .optional(),
            }),
          ),
        }),
      })
      .parse(await response.json());

    expect(response.status).toBe(200);
    expect(body.result.tools.map(tool => tool.name)).toEqual([
      'namespaces_list',
      'namespaces_get',
      'namespaces_create',
      'namespaces_update',
      'namespaces_delete',
      'tags_list',
      'tags_get',
      'tags_create',
      'tags_update',
      'tags_delete',
      'places_search_google',
      'places_tag',
      'places_untag',
      'places_list',
      'places_sync_status',
      'places_import',
      'places_get_import_run',
      'places_list_import_runs',
      'query_describe',
    ]);
    expect(
      body.result.tools.find(tool => tool.name === 'places_list')?.annotations,
    ).toMatchObject({readOnlyHint: true});
    expect(
      body.result.tools.find(tool => tool.name === 'tags_delete')?.annotations,
    ).toMatchObject({destructiveHint: true});

    for (const tool of body.result.tools) {
      expect(undocumentedProperties(tool.inputSchema), tool.name).toEqual([]);

      if (tool.outputSchema) {
        expect(undocumentedProperties(tool.outputSchema), tool.name).toEqual([]);
      }
    }
  });

  it('calls the existing oRPC implementation', async () => {
    const app = createApp({} as Context);
    const response = await post(app, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {name: 'query_describe'},
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: {
        structuredContent: {
          filters: expect.arrayContaining([expect.objectContaining({name: 'tag'})]),
        },
      },
    });
  });
});

function undocumentedProperties(schema: unknown, path: string[] = []): string[] {
  if (!isRecord(schema)) {
    return [];
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const missing = Object.entries(properties).flatMap(([name, property]) => {
    const propertyPath = [...path, name];
    const description = isRecord(property) ? property.description : undefined;

    return [
      ...(typeof description === 'string' && description.length > 0
        ? []
        : [propertyPath.join('.')]),
      ...undocumentedProperties(property, propertyPath),
    ];
  });
  const nested = ['allOf', 'anyOf', 'oneOf'].flatMap(keyword => {
    const schemas = schema[keyword];
    return Array.isArray(schemas)
      ? schemas.flatMap(value => undocumentedProperties(value, path))
      : [];
  });

  return [...missing, ...nested, ...undocumentedProperties(schema.items, path)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
