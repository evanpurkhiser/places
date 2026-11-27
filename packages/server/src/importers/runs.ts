import {eq, sql} from 'drizzle-orm';
import {fromDrizzle, type JobWithMetadata} from 'pg-boss';

import type {Database} from '../db/index.ts';
import {importRuns} from '../db/schema.ts';
import {defaultUserId} from '../db/users.ts';

type RunType = typeof importRuns.$inferInsert.type;
export type ImportRunIdentity = Pick<
  typeof importRuns.$inferSelect,
  'id' | 'requestedByUserId'
>;

type RunWriter = Pick<Database, 'insert' | 'select' | 'update'>;

interface QueuedImport {
  input: unknown;
  sourceId?: string;
  requestedByUserId?: string;
}

type QueueDatabase = ReturnType<typeof fromDrizzle>;

export function withImportEnqueue(
  db: Database,
  type: RunType,
  run: QueuedImport,
  enqueue: (db: QueueDatabase) => Promise<string | null>,
) {
  return db.transaction(async tx => {
    const id = await enqueue(fromDrizzle(tx, sql));

    if (id !== null) {
      await recordQueuedImport(tx, id, type, run);
    }

    return id;
  });
}

/** Use the source transaction so capture, child jobs, and run records commit together. */
export async function withImportBatchEnqueue(
  tx: Pick<Database, 'insert' | 'execute' | 'select'>,
  type: RunType,
  runs: QueuedImport[],
  enqueue: (db: QueueDatabase) => Promise<string[] | null>,
) {
  if (runs.length === 0) {
    return [];
  }

  const ids = await enqueue(fromDrizzle(tx, sql));

  if (!ids || ids.length !== runs.length) {
    throw new Error('Some place imports could not be queued.');
  }

  await Promise.all(
    ids.map((id, index) => {
      const run = runs[index]!;
      return recordQueuedImport(tx, id, type, run);
    }),
  );

  return ids;
}

async function recordQueuedImport(
  db: Pick<Database, 'insert' | 'select'>,
  id: string,
  type: RunType,
  run: QueuedImport,
) {
  await db
    .insert(importRuns)
    .values({
      id,
      type,
      ...run,
      requestedByUserId: run.requestedByUserId ?? defaultUserId(db),
    })
    .onConflictDoNothing();
}

export async function recordImportStarted(
  db: RunWriter,
  id: string,
  type: RunType,
  input: unknown,
) {
  await recordQueuedImport(db, id, type, {input});
  const [run] = await db
    .update(importRuns)
    .set({
      state: 'active',
      attempts: sql`${importRuns.attempts} + 1`,
      startedAt: new Date(),
      finishedAt: null,
      error: null,
    })
    .where(eq(importRuns.id, id))
    .returning({id: importRuns.id, requestedByUserId: importRuns.requestedByUserId});

  if (!run) {
    throw new Error('Import run disappeared before it could start.');
  }

  return run;
}

export async function recordImportCompleted(
  db: Pick<Database, 'update'>,
  id: string,
  output: unknown,
) {
  const sourceId =
    output && typeof output === 'object' && 'sourceId' in output
      ? String(output.sourceId)
      : undefined;

  await db
    .update(importRuns)
    .set({
      state: 'completed',
      // Preserve results committed alongside the source and child jobs.
      output: sql`coalesce(${importRuns.output}, ${JSON.stringify(output)}::jsonb)`,
      sourceId,
      finishedAt: new Date(),
    })
    .where(eq(importRuns.id, id));
}

export async function recordImportFailed(
  db: Pick<Database, 'update'>,
  id: string,
  error: string,
  willRetry: boolean,
) {
  await db
    .update(importRuns)
    .set({
      state: willRetry ? 'retry' : 'failed',
      error,
      finishedAt: willRetry ? null : new Date(),
    })
    .where(eq(importRuns.id, id));
}

export async function recordImportCapture(
  db: Pick<Database, 'update'>,
  id: string,
  output: {sourceId: string},
) {
  await db
    .update(importRuns)
    .set({sourceId: output.sourceId, output})
    .where(eq(importRuns.id, id));
}

export function withImportRun(
  db: RunWriter,
  type: RunType,
  handler: (data: unknown, run: ImportRunIdentity) => Promise<unknown>,
) {
  return async (data: unknown, job: JobWithMetadata<unknown>) => {
    const run = await recordImportStarted(db, job.id, type, data);

    try {
      const output = await handler(data, run);
      await recordImportCompleted(db, job.id, output);
      return output;
    } catch (error) {
      await recordImportFailed(
        db,
        job.id,
        error instanceof Error ? error.message : 'Job failed.',
        job.retryCount < job.retryLimit,
      );
      throw error;
    }
  };
}
