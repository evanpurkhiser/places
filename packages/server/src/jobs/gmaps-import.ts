import {importTag, placeTag} from '@places/common/contract/place';
import {placeSourceInput} from '@places/common/contract/source';
import type {PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {WorkerQueueConfig} from '../config.ts';
import type {Database} from '../db/index.ts';
import {importPlace} from '../importers/import-place.ts';
import {
  withImportBatchEnqueue,
  withImportEnqueue,
  withImportRun,
} from '../importers/runs.ts';
import type {GooglePlaces} from '../services/google/index.ts';

import {registerWorker} from './worker.ts';

export const importQueue = 'gmaps-import';
export const queueOptions = {
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};
const importAssignment = placeTag
  .pick({tagId: true})
  .extend({note: importTag.shape.note});

export const importPayload = z.object({
  googlePlaceId: z.string().min(1),
  tags: z.array(importAssignment).default([]),
  notes: z.string().optional(),
  source: placeSourceInput.optional(),
});

export async function enqueuePlaceImport(
  jobs: PgBoss,
  db: Database,
  input: z.input<typeof importPayload>,
) {
  const payload = importPayload.parse(input);

  const id = await withImportEnqueue(
    db,
    'gmaps',
    {input: payload, sourceId: payload.source?.sourceId},
    queueDb => jobs.send(importQueue, payload, {db: queueDb}),
  );

  if (id === null) {
    throw new Error('Could not queue the Google Maps import.');
  }

  return id;
}

export function enqueuePlaceImports(
  jobs: PgBoss,
  tx: Pick<Database, 'insert' | 'execute'>,
  inputs: Array<z.input<typeof importPayload>>,
) {
  const imports = inputs.map(input => ({data: importPayload.parse(input)}));

  return withImportBatchEnqueue(
    tx,
    'gmaps',
    imports.map(({data}) => ({input: data, sourceId: data.source?.sourceId})),
    queueDb => jobs.insert(importQueue, imports, {db: queueDb, returnId: true}),
  );
}

interface WorkerDependencies {
  db: Database;
  google: GooglePlaces;
}

/**
 * Register the worker with its dependencies and queue settings.
 */
export function registerImportWorker(
  jobs: PgBoss,
  {db, google}: WorkerDependencies,
  options: WorkerQueueConfig,
) {
  return registerWorker(
    jobs,
    importQueue,
    options,
    withImportRun(db, 'gmaps', data => {
      const {googlePlaceId, tags, notes, source} = importPayload.parse(data);

      return importPlace(db, google, googlePlaceId, tags, notes, source);
    }),
  );
}
