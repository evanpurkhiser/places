import type {PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {WorkerQueueConfig} from '../config.ts';
import {
  importInstagramPost,
  type InstagramImportDependencies,
} from '../importers/import-instagram.ts';
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
 * Enqueue one ingestion per shortcode while a matching job is queued or active.
 */
export function enqueueInstagramImport(
  jobs: PgBoss,
  url: string,
  options?: ImportOptions,
) {
  const shortcode = instagramShortcode(url);
  return jobs.send(importQueue, {shortcode, ...options}, {singletonKey: shortcode});
}

/**
 * Register the Instagram orchestration job with the shared worker runner.
 */
export function registerInstagramImportWorker(
  jobs: PgBoss,
  dependencies: InstagramImportDependencies,
  options: WorkerQueueConfig,
) {
  return registerWorker(jobs, importQueue, options, data => {
    const {shortcode, ...options} = importPayload.parse(data);
    return importInstagramPost(jobs, dependencies, shortcode, options);
  });
}
