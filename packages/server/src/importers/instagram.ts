import {and, eq, inArray, or} from 'drizzle-orm';
import {z} from 'zod';

import type {Context} from '../context.ts';
import {importRuns, placeSources} from '../db/schema.ts';
import {enqueueInstagramImport} from '../jobs/instagram-import.ts';
import {instagramShortcode} from '../services/instagram/index.ts';

import {googleImporter} from './gmaps.ts';
import {
  type Importer,
  type ImportRun,
  type ImportStatus,
  pendingStatus,
} from './types.ts';

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
    const statuses = await getInstagramStatuses([run], context);

    return statuses.get(run.id)!;
  },
};

export async function getInstagramStatuses(
  runs: ImportRun[],
  context: Pick<Context, 'db'>,
  preloadedRuns?: ImportRun[],
) {
  const completed = runs
    .filter(run => run.state === 'completed')
    .map(run => [run.id, dispatchResult.parse(run.output)] as const);
  const resultsById = new Map(completed);
  const sourceIds = [...new Set(completed.map(([, result]) => result.sourceId))];
  const childIds = [
    ...new Set(completed.flatMap(([, result]) => (result.skipped ? [] : result.jobIds))),
  ];
  const skippedSourceIds = [
    ...new Set(
      completed.flatMap(([, result]) => (result.skipped ? [result.sourceId] : [])),
    ),
  ];
  const childPredicate = or(
    childIds.length ? inArray(importRuns.id, childIds) : undefined,
    skippedSourceIds.length ? inArray(importRuns.sourceId, skippedSourceIds) : undefined,
  );
  const children = preloadedRuns
    ? preloadedRuns.filter(run => run.type === 'gmaps')
    : childPredicate
      ? context.db
          .select()
          .from(importRuns)
          .where(and(eq(importRuns.type, 'gmaps'), childPredicate))
      : Promise.resolve([]);
  const saved = sourceIds.length
    ? context.db
        .select({placeId: placeSources.placeId, sourceId: placeSources.sourceId})
        .from(placeSources)
        .where(inArray(placeSources.sourceId, sourceIds))
    : Promise.resolve([]);
  const [childRuns, savedAssignments] = await Promise.all([children, saved]);
  const savedBySource = Map.groupBy(savedAssignments, assignment => assignment.sourceId);
  const runsById = new Map(childRuns.map(run => [run.id, run]));
  const googleRunsBySource = Map.groupBy(
    childRuns.filter(run => run.sourceId !== null),
    run => run.sourceId!,
  );

  return new Map(
    await Promise.all(
      runs.map(async run => {
        if (run.state !== 'completed') {
          return [run.id, pendingStatus(run)] as const;
        }

        const result = resultsById.get(run.id)!;
        const children = result.skipped
          ? (googleRunsBySource.get(result.sourceId) ?? [])
          : result.jobIds.map(id => runsById.get(id));
        const placeIds = (savedBySource.get(result.sourceId) ?? []).map(
          assignment => assignment.placeId,
        );

        return [run.id, await instagramStatus(children, placeIds, context)] as const;
      }),
    ),
  );
}

async function instagramStatus(
  children: Array<ImportRun | undefined>,
  savedPlaceIds: string[],
  context: Pick<Context, 'db'>,
): Promise<ImportStatus> {
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
  const failed = statuses.find(({state}) => state === 'failed' || state === 'cancelled');
  const pending = statuses.some(({state}) => state !== 'completed');

  return {
    state: failed?.state ?? (pending ? 'active' : 'completed'),
    placeIds: [
      ...new Set([...savedPlaceIds, ...statuses.flatMap(({placeIds}) => placeIds)]),
    ],
    error: failed?.error ?? statuses.find(({state}) => state === 'retry')?.error ?? null,
  };
}
