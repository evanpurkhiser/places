import {and, eq, inArray} from 'drizzle-orm';
import {z} from 'zod';

import {importRuns, placeSources} from '../db/schema.ts';
import {enqueueInstagramImport} from '../jobs/instagram-import.ts';
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
  accepts(input) {
    try {
      instagramShortcode(input);
      return true;
    } catch {
      return false;
    }
  },
  enqueue: (input, options, {jobs, db}) =>
    enqueueInstagramImport(jobs, db, input, options),
  async getStatus(run, context) {
    if (run.state !== 'completed') {
      return pendingStatus(run);
    }

    const {sourceId, jobIds, skipped} = dispatchResult.parse(run.output);
    // A skipped capture resumes observation of the source's original imports.
    const recorded = await context.db
      .select()
      .from(importRuns)
      .where(
        and(
          eq(importRuns.type, 'gmaps'),
          skipped ? eq(importRuns.sourceId, sourceId) : inArray(importRuns.id, jobIds),
        ),
      );
    const byId = new Map(recorded.map(child => [child.id, child]));
    const children = skipped ? recorded : jobIds.map(id => byId.get(id));
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
              error: 'A place import record is missing; completion cannot be verified.',
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
