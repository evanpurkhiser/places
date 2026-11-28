import {parse} from 'yaml';
import {z} from 'zod';

import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';

import {resolveSocialPostConfig, socialPostOverrides} from './config/media-import.ts';

/**
 * Define per-queue throughput with a queue-specific concurrency default.
 */
const workerQueue = (concurrency: number) =>
  z
    .strictObject({
      batchSize: z
        .number()
        .int()
        .positive()
        .default(1)
        .describe('Jobs claimed per polling worker; jobs in a batch run concurrently.'),
      concurrency: z
        .number()
        .int()
        .positive()
        .default(concurrency)
        .describe('Independent polling workers for this queue in each process.'),
    })
    .prefault({});

export const workersConfig = z
  .strictObject({
    'gmaps-import': workerQueue(1),
    'gmaps-sync': workerQueue(1),
    'instagram-import': workerQueue(1),
  })
  .prefault({});
export type WorkerQueueConfig = z.infer<typeof workersConfig>['gmaps-sync'];

const configInput = z.strictObject({
  google: z
    .strictObject({
      apiKey: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          'Google Places API (New) key; required for imports and place name resolution.',
        ),
    })
    .prefault({})
    .describe('Google Places integration.'),
  openai: z
    .strictObject({
      key: z
        .string()
        .trim()
        .min(1)
        .describe(
          'OpenAI API key shared by model integrations; required for Instagram ingestion.',
        ),
    })
    .describe('OpenAI integration.'),
  'social-posts': socialPostOverrides
    .optional()
    .describe('Shared capture and tagging defaults for social post importers.'),
  instagram: socialPostOverrides
    .optional()
    .describe('Instagram capture and tagging overrides.'),
  workers: workersConfig,
  server: z
    .strictObject({
      host: z.string().default('127.0.0.1').describe('Network address to listen on.'),
      port: z
        .number()
        .int()
        .min(0)
        .max(65535)
        .default(5188)
        .describe('TCP port to listen on; 0 selects an available port.'),
    })
    .prefault({})
    .describe('HTTP server settings.'),
  database: z
    .strictObject({
      url: z
        .url({protocol: /^postgres(ql)?$/})
        .describe('PostgreSQL connection URL, including credentials and database name.'),
    })
    .describe('Database connection settings.'),
});

export const configSchema = configInput.transform(
  ({'social-posts': defaults, instagram, ...config}, ctx) => {
    const resolved = resolveSocialPostConfig(defaults, instagram);

    if (!resolved.success) {
      for (const issue of resolved.error.issues) {
        ctx.addIssue({...issue, path: ['instagram', ...issue.path]});
      }

      return z.NEVER;
    }

    return {...config, instagram: resolved.data};
  },
);

export type Config = z.infer<typeof configSchema>;

export async function loadConfig(args = process.argv.slice(2)): Promise<Config> {
  const {values} = parseArgs({
    args,
    options: {config: {type: 'string'}},
  });
  return readConfig(values.config);
}

export async function readConfig(path = 'config.yaml'): Promise<Config> {
  const result = configSchema.safeParse(
    parse(await readFile(path, 'utf8'), {prettyErrors: false}),
  );

  if (!result.success) {
    // Report paths and validation messages without including secret values.
    throw new Error(
      result.error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join('\n'),
    );
  }

  return result.data;
}
