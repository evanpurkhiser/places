import type {PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {WorkerQueueConfig} from '../config.ts';
import type {Database} from '../db/index.ts';
import {importInstagramPost} from '../importers/import-instagram.ts';
import type {MediaImportDependencies} from '../importers/import-media.ts';
import {withImportEnqueue, withImportRun} from '../importers/runs.ts';
import type {ImportOptions} from '../importers/types.ts';
import {instagramShortcode} from '../services/instagram/index.ts';

import {importPayload as googleImportPayload} from './gmaps-import.ts';
import {registerWorker} from './worker.ts';

export const importQueue = 'instagram-import';
export const queueOptions = {
  policy: 'exclusive',
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 900,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};
const importPayload = z.object({
  shortcode: z.string().regex(/^[A-Za-z0-9_-]+$/),
  tags: googleImportPayload.shape.tags,
  notes: googleImportPayload.shape.notes,
});

/**
 * Deduplicate queued or active imports of the same shortcode by the same user.
 */
export function enqueueInstagramImport(
  jobs: PgBoss,
  db: Database,
  url: string,
  options?: ImportOptions,
  requestedByUserId?: string,
) {
  const shortcode = instagramShortcode(url);
  const input = {shortcode, ...options};

  const singletonKey = `${shortcode}:${requestedByUserId ?? 'default'}`;

  return withImportEnqueue(db, 'instagram', {input, requestedByUserId}, queueDb =>
    jobs.send(importQueue, input, {singletonKey, db: queueDb}),
  );
}

/**
 * Register the Instagram orchestration job with the shared worker runner.
 */
export function registerInstagramImportWorker(
  jobs: PgBoss,
  dependencies: MediaImportDependencies,
  options: WorkerQueueConfig,
) {
  return registerWorker(
    jobs,
    importQueue,
    options,
    withImportRun(dependencies.db, 'instagram', (data, run) => {
      const {shortcode, ...options} = importPayload.parse(data);
      return importInstagramPost(jobs, dependencies, shortcode, options, run);
    }),
  );
}
