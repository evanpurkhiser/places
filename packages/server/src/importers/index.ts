import type {ImportTag} from '@places/common/contract/place';
import {eq} from 'drizzle-orm';

import type {Context} from '../context.ts';
import {importRuns} from '../db/schema.ts';

import {
  ImportNotFoundError,
  ImportUnavailableError,
  InvalidImportInputError,
} from './errors.ts';
import {googleImporter} from './gmaps.ts';
import {instagramImporter} from './instagram.ts';
import {resolveTags} from './tags.ts';

const importers = [googleImporter, instagramImporter];

export async function enqueueImport(
  input: string,
  context: Context,
  tags: ImportTag[] = [],
  notes?: string,
) {
  const importer = importers.find(candidate => candidate.accepts(input));

  if (!importer) {
    throw new InvalidImportInputError(
      'Unsupported import input. Currently supported: Google Maps place URLs, gmaps:<place_id>, and Instagram post or reel URLs.',
    );
  }

  const resolvedTags = await resolveTags(tags, context);
  const jobId = await importer.enqueue(input, {tags: resolvedTags, notes}, context);

  if (!jobId) {
    throw new ImportUnavailableError(
      'Could not queue the import. It may already be queued or active.',
    );
  }

  return {jobId, type: importer.type};
}

export async function getImportStatus(jobId: string, context: Pick<Context, 'db'>) {
  const [run] = await context.db
    .select()
    .from(importRuns)
    .where(eq(importRuns.id, jobId));

  if (!run) {
    throw new ImportNotFoundError('Import not found.');
  }

  const importer = importers.find(importer => importer.type === run.type)!;
  return {
    jobId: run.id,
    type: run.type,
    ...(await importer.getStatus(run, context)),
  };
}
