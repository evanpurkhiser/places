import type {ImportTag} from '@places/common/contract/place';
import {desc, eq} from 'drizzle-orm';

import type {Context, RequestContext} from '../context.ts';
import {importRuns} from '../db/schema.ts';

import {
  ImportNotFoundError,
  ImportUnavailableError,
  InvalidImportInputError,
} from './errors.ts';
import {googleImporter} from './gmaps.ts';
import {instagramImporter} from './instagram.ts';
import {getMediaImportStatuses} from './media-status.ts';
import {rednoteImporter} from './rednote.ts';
import {resolveTags} from './tags.ts';
import type {ImportRun, ImportStatus} from './types.ts';

const importers = [googleImporter, instagramImporter, rednoteImporter];

export async function enqueueImport(
  input: string,
  context: RequestContext,
  tags: ImportTag[] = [],
  notes?: string,
) {
  const importer = importers.find(candidate => candidate.accepts(input));

  if (!importer) {
    throw new InvalidImportInputError(
      'Unsupported import input. Currently supported: Google Maps place URLs, gmaps:<place_id>, Instagram posts and reels, and RedNote notes.',
    );
  }

  const resolvedTags = await resolveTags(tags, context);
  const jobId = await importer.enqueue(input, {tags: resolvedTags, notes}, context);

  if (!jobId) {
    throw new ImportUnavailableError(
      'Could not queue the import. It may already be queued or active.',
    );
  }

  return {jobId, importType: importer.type};
}

export async function getImportStatus(jobId: string, context: Pick<Context, 'db'>) {
  const [run] = await context.db
    .select()
    .from(importRuns)
    .where(eq(importRuns.id, jobId));

  if (!run) {
    throw new ImportNotFoundError('Import not found.');
  }

  const [status] = await resolveImportStatuses([run], context);

  return status!;
}

export async function listImportStatuses(context: Pick<Context, 'db'>, limit = 50) {
  const runs = await context.db
    .select()
    .from(importRuns)
    .orderBy(desc(importRuns.createdAt), desc(importRuns.id))
    .limit(limit);

  return resolveImportStatuses(runs, context, runs);
}

async function resolveImportStatuses(
  runs: ImportRun[],
  context: Pick<Context, 'db'>,
  preloadedRuns?: ImportRun[],
) {
  const mediaStatuses = await getMediaImportStatuses(
    runs.filter(run => run.type !== 'gmaps'),
    context,
    preloadedRuns,
  );

  return Promise.all(
    runs.map(run =>
      run.type !== 'gmaps'
        ? statusResponse(run, mediaStatuses.get(run.id)!)
        : importStatus(run, context),
    ),
  );
}

async function importStatus(run: ImportRun, context: Pick<Context, 'db'>) {
  const importer = importers.find(importer => importer.type === run.type)!;
  return statusResponse(run, await importer.getStatus(run, context));
}

function statusResponse(run: ImportRun, status: ImportStatus) {
  return {
    jobId: run.id,
    importType: run.type,
    sourceId: run.sourceId,
    ...status,
  };
}
