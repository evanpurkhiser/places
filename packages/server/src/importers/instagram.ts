import {eq} from 'drizzle-orm';
import {z} from 'zod';

import {placeSources} from '../db/schema.ts';
import {importQueue as googleQueue} from '../jobs/gmaps-import.ts';
import {enqueueInstagramImport, importQueue} from '../jobs/instagram-import.ts';
import {instagramShortcode} from '../services/instagram/index.ts';

import {googleImporter} from './gmaps.ts';
import {type Importer, type ImportStatus, pendingStatus} from './types.ts';

const dispatchResult = z.object({
  sourceId: z.uuid(),
  jobIds: z.array(z.uuid()),
  skipped: z.boolean(),
});

export const instagramImporter: Importer = {
  type: 'instagram',
  queue: importQueue,
  accepts(input) {
    try {
      instagramShortcode(input);
      return true;
    } catch {
      return false;
    }
  },
  enqueue: (input, options, {jobs}) => enqueueInstagramImport(jobs, input, options),
  async getStatus(job, context) {
    if (job.state !== 'completed') {
      return pendingStatus(job);
    }

    const {sourceId, jobIds, skipped} = dispatchResult.parse(job.output);
    // A skipped capture resumes observation of the source's original imports.
    const children = skipped
      ? await context.jobs.findJobs(googleQueue, {data: {source: {sourceId}}})
      : await Promise.all(jobIds.map(id => context.jobs.getJobById(googleQueue, id)));
    const saved = await context.db
      .select({placeId: placeSources.placeId})
      .from(placeSources)
      .where(eq(placeSources.sourceId, sourceId));
    const statuses = await Promise.all(
      children.map(child =>
        child
          ? googleImporter.getStatus(child, context)
          : Promise.resolve<ImportStatus>({
              state: 'failed',
              placeIds: [],
              error:
                'A place import job is missing or expired; completion cannot be verified.',
            }),
      ),
    );
    const failed = statuses.find(
      ({state}) => state === 'failed' || state === 'cancelled',
    );
    const pending = statuses.some(({state}) => state !== 'completed');

    return {
      state: failed?.state ?? (pending ? 'active' : 'completed'),
      placeIds: [
        ...new Set([
          ...saved.map(({placeId}) => placeId),
          ...statuses.flatMap(({placeIds}) => placeIds),
        ]),
      ],
      error:
        failed?.error ?? statuses.find(({state}) => state === 'retry')?.error ?? null,
    };
  },
};
