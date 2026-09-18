import {parse} from 'yaml';
import {z} from 'zod';

import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';

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
    'gmaps-sync': workerQueue(8),
  })
  .prefault({});
export type WorkerQueueConfig = z.infer<typeof workersConfig>['gmaps-sync'];

export const configSchema = z.strictObject({
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

export type Config = z.infer<typeof configSchema>;

export async function loadConfig(args = process.argv.slice(2)): Promise<Config> {
  const {values} = parseArgs({
    args,
    options: {config: {type: 'string', default: 'config.yaml'}},
  });
  const result = configSchema.safeParse(
    parse(await readFile(values.config!, 'utf8'), {prettyErrors: false}),
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
