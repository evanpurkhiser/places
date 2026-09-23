import type {z} from 'zod';

import type {Context} from '../context.ts';
import type {importRuns} from '../db/schema.ts';
import type {importPayload} from '../jobs/gmaps-import.ts';

export type ImportOptions = Pick<z.infer<typeof importPayload>, 'tags' | 'notes'>;

export type ImportRun = typeof importRuns.$inferSelect;

export interface ImportStatus {
  state: ImportRun['state'];
  placeIds: string[];
  error: string | null;
}

export interface Importer {
  type: 'gmaps' | 'instagram';
  accepts(input: string): boolean;
  enqueue(
    input: string,
    options: ImportOptions,
    context: Context,
  ): Promise<string | null>;
  getStatus(
    run: ImportRun,
    context: Pick<Context, 'db'>,
  ): ImportStatus | Promise<ImportStatus>;
}

export function pendingStatus(run: ImportRun): ImportStatus {
  return {
    state: run.state,
    placeIds: [],
    error:
      run.state === 'failed' || run.state === 'retry' || run.state === 'cancelled'
        ? (run.error ?? 'Import failed or was cancelled.')
        : null,
  };
}
