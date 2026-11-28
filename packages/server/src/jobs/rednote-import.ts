import type {PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {WorkerQueueConfig} from '../config.ts';
import type {Database} from '../db/index.ts';
import {InvalidImportInputError} from '../importers/errors.ts';
import type {MediaImportDependencies} from '../importers/import-media.ts';
import {importRedNotePost} from '../importers/import-rednote.ts';
import {withImportEnqueue, withImportRun} from '../importers/runs.ts';
import type {ImportOptions} from '../importers/types.ts';
import {parseRedNoteUrl} from '../services/rednote/urls.ts';

import {importPayload as googleImportPayload} from './gmaps-import.ts';
import {mediaImportQueueOptions} from './media-import.ts';
import {registerWorker} from './worker.ts';

export const importQueue = 'rednote-import';
export const queueOptions = mediaImportQueueOptions;

const importPayload = z.object({
  url: z.url(),
  tags: googleImportPayload.shape.tags,
  notes: googleImportPayload.shape.notes,
});

export function enqueueRedNoteImport(
  jobs: PgBoss,
  db: Database,
  url: string,
  options: ImportOptions,
  requestedByUserId?: string,
) {
  const link = parseRedNoteUrl(url);

  if (!link) {
    throw new InvalidImportInputError('Expected a RedNote note or share link.');
  }

  const input = {url: link.url.href, ...options};
  const identity = link.kind === 'note' ? link.externalId : link.url.href;
  const singletonKey = `${identity}:${requestedByUserId ?? 'default'}`;
  return withImportEnqueue(db, 'rednote', {input, requestedByUserId}, queueDb =>
    jobs.send(importQueue, input, {singletonKey, db: queueDb}),
  );
}

export function registerRedNoteImportWorker(
  jobs: PgBoss,
  dependencies: MediaImportDependencies,
  options: WorkerQueueConfig,
) {
  return registerWorker(
    jobs,
    importQueue,
    options,
    withImportRun(dependencies.db, 'rednote', (data, run) => {
      const {url, ...options} = importPayload.parse(data);
      return importRedNotePost(jobs, dependencies, url, options, run);
    }),
  );
}
