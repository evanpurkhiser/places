import {importTag, placeTag} from '@places/common/contract/place';
import {placeSourceInput} from '@places/common/contract/source';
import {sql} from 'drizzle-orm';
import {fromDrizzle, type PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {WorkerQueueConfig} from '../config.ts';
import type {Database} from '../db/index.ts';
import {importPlace} from '../importers/import-place.ts';
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

export function enqueuePlaceImport(jobs: PgBoss, input: z.input<typeof importPayload>) {
  return jobs.send(importQueue, importPayload.parse(input));
}

export async function enqueuePlaceImports(
  jobs: PgBoss,
  tx: Pick<Database, 'insert' | 'execute'>,
  inputs: Array<z.input<typeof importPayload>>,
) {
  if (inputs.length === 0) {
    return [];
  }

  const imports = inputs.map(input => ({data: importPayload.parse(input)}));
  const ids = await jobs.insert(importQueue, imports, {
    db: fromDrizzle(tx, sql),
    returnId: true,
  });

  if (!ids || ids.length !== imports.length) {
    throw new Error('Some place imports could not be queued.');
  }

  return ids;
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
  return registerWorker(jobs, importQueue, options, data => {
    const {googlePlaceId, tags, notes, source} = importPayload.parse(data);

    return importPlace(db, google, googlePlaceId, tags, notes, source);
  });
}
