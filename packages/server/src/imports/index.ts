import {ORPCError} from '@orpc/server';
import {importResult} from '@places/common/contract/place';

import {importPayload, importQueue} from '../jobs/gmaps-import.ts';
import type {Context} from '../rpc/context.ts';
import {isGoogleMapsInput} from '../services/google/index.ts';

const importers = [
  {
    type: 'gmaps' as const,
    queue: importQueue,
    accepts: isGoogleMapsInput,
    prepare: async (input: string, context: Context) =>
      importPayload.parse({googlePlaceId: await context.google.resolve(input)}),
  },
];

export async function enqueueImport(input: string, context: Context) {
  const importer = importers.find(candidate => candidate.accepts(input));

  if (!importer) {
    throw new ORPCError('BAD_REQUEST', {
      message:
        'Unsupported import input. Currently supported: Google Maps place URLs and gmaps:<place_id>.',
    });
  }

  const payload = await importer.prepare(input, context);
  const jobId = await context.jobs.send(importer.queue, payload);

  if (!jobId) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {message: 'Could not queue the import.'});
  }

  return {jobId, type: importer.type};
}

export async function getImportStatus(jobId: string, {jobs}: Context) {
  for (const importer of importers) {
    const job = await jobs.getJobById(importer.queue, jobId);

    if (!job) {
      continue;
    }

    return {
      jobId: job.id,
      type: importer.type,
      state: job.state,
      placeIds: job.state === 'completed' ? importResult.parse(job.output).placeIds : [],
      error:
        job.state === 'failed' || job.state === 'retry'
          ? 'Import failed. Check the provider configuration and retry.'
          : null,
    };
  }

  throw new ORPCError('NOT_FOUND', {message: 'Import not found or expired.'});
}
