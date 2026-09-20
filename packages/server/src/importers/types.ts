import type {JobWithMetadata} from 'pg-boss';
import type {z} from 'zod';

import type {importPayload} from '../jobs/gmaps-import.ts';
import type {Context} from '../rpc/context.ts';

export type ImportOptions = Pick<z.infer<typeof importPayload>, 'tags' | 'notes'>;

export interface ImportStatus {
  state: JobWithMetadata['state'];
  placeIds: string[];
  error: string | null;
}

export interface Importer {
  type: 'gmaps';
  queue: string;
  accepts(input: string): boolean;
  enqueue(
    input: string,
    options: ImportOptions,
    context: Context,
  ): Promise<string | null>;
  getStatus(
    job: JobWithMetadata<unknown>,
    context: Context,
  ): ImportStatus | Promise<ImportStatus>;
}

export function pendingStatus(job: JobWithMetadata<unknown>): ImportStatus {
  return {
    state: job.state,
    placeIds: [],
    error:
      job.state === 'failed' || job.state === 'retry'
        ? 'Import failed. Check the provider configuration and retry.'
        : null,
  };
}
