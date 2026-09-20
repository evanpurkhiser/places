import {ORPCError} from '@orpc/server';
import type {ImportTag} from '@places/common/contract/place';

import type {Context} from '../rpc/context.ts';

import {googleImporter} from './gmaps.ts';
import {resolveTags} from './tags.ts';

const importers = [googleImporter];

export async function enqueueImport(
  input: string,
  context: Context,
  tags: ImportTag[] = [],
  notes?: string,
) {
  const importer = importers.find(candidate => candidate.accepts(input));

  if (!importer) {
    throw new ORPCError('BAD_REQUEST', {
      message:
        'Unsupported import input. Currently supported: Google Maps place URLs and gmaps:<place_id>.',
    });
  }

  const resolvedTags = await resolveTags(tags, context);
  const jobId = await importer.enqueue(input, {tags: resolvedTags, notes}, context);

  if (!jobId) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {
      message: 'Could not queue the import.',
    });
  }

  return {jobId, type: importer.type};
}

export async function getImportStatus(jobId: string, context: Context) {
  for (const importer of importers) {
    const job = await context.jobs.getJobById(importer.queue, jobId);

    if (!job) {
      continue;
    }

    return {
      jobId: job.id,
      type: importer.type,
      ...(await importer.getStatus(job, context)),
    };
  }

  throw new ORPCError('NOT_FOUND', {message: 'Import not found or expired.'});
}
