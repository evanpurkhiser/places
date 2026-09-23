import {implement, ORPCError} from '@orpc/server';
import {contract} from '@places/common/contract';
import {type PlaceSort, placeSource} from '@places/common/contract/place';
import {SearchError} from '@places/common/search';
import {and, asc, desc, eq, getTableColumns, inArray, or, sql} from 'drizzle-orm';
import {z} from 'zod';

import type {Context} from '../context.ts';
import type {Database} from '../db/index.ts';
import {places, placeSources, placeTags, sources, tags} from '../db/schema.ts';
import {compilePlaceQuery} from '../filter-engine/index.ts';
import {enqueueImport, getImportStatus, listImportStatuses} from '../importers/index.ts';
import {syncQueue, syncPayload} from '../jobs/gmaps-sync.ts';

import {rethrowGoogleError} from './google-errors.ts';
import {rethrowImportError} from './import-errors.ts';

const api = implement(contract.places).$context<Context>();

export const placeRouter = api.router({
  searchGoogle: api.searchGoogle.handler(async ({input, context: {google}}) => {
    const results = await google.search(input.query, 10).catch(rethrowGoogleError);

    return results.map(result => ({
      input: `gmaps:${result.id}`,
      name: result.displayName.text,
      formattedAddress: result.formattedAddress,
      googleMapsUrl: result.googleMapsUri,
      primaryTypeDisplayName: result.primaryTypeDisplayName?.text || null,
    }));
  }),
  tag: api.tag.handler(({input, context: {db}}) =>
    db.transaction(async tx => {
      const tagId = await resolvePlaceTag(tx, input.placeId, input.tag);
      const [assignment] = await tx
        .insert(placeTags)
        .values({
          placeId: input.placeId,
          tagId,
          note: input.notes === '' ? null : input.notes,
        })
        .onConflictDoUpdate({
          target: [placeTags.placeId, placeTags.tagId],
          set:
            input.notes === undefined
              ? {tagId}
              : {note: input.notes === '' ? null : input.notes},
        })
        .returning();

      return assignment!;
    }),
  ),
  untag: api.untag.handler(({input, context: {db}}) =>
    db.transaction(async tx => {
      const tagId = await resolvePlaceTag(tx, input.placeId, input.tag);
      const removed = await tx
        .delete(placeTags)
        .where(and(eq(placeTags.placeId, input.placeId), eq(placeTags.tagId, tagId)))
        .returning({tagId: placeTags.tagId});

      return {placeId: input.placeId, tagId, removed: removed.length > 0};
    }),
  ),
  list: api.list.handler(async ({input, context: {db, google}}) => {
    const predicate = await queryPredicate(input?.query, {db, google});
    const rows = await db
      .select({
        ...getTableColumns(places),
        latitude: sql<number>`ST_Y(${places.coordinates}::geometry)`,
        longitude: sql<number>`ST_X(${places.coordinates}::geometry)`,
      })
      .from(places)
      .where(predicate)
      .orderBy(...placeOrder(input?.sort ?? 'recently-saved'));

    if (!rows.length) {
      return [];
    }

    const assignments = await db
      .select({...getTableColumns(placeTags), tag: getTableColumns(tags)})
      .from(placeTags)
      .innerJoin(tags, eq(placeTags.tagId, tags.id))
      .where(
        and(
          eq(tags.archived, false),
          inArray(
            placeTags.placeId,
            rows.map(place => place.id),
          ),
        ),
      )
      .orderBy(tags.name, tags.id);
    const tagsByPlace = Map.groupBy(assignments, assignment => assignment.placeId);
    const sourceAssignments = await db
      .select({...getTableColumns(placeSources), source: getTableColumns(sources)})
      .from(placeSources)
      .innerJoin(sources, eq(placeSources.sourceId, sources.id))
      .where(
        inArray(
          placeSources.placeId,
          rows.map(place => place.id),
        ),
      )
      .orderBy(desc(placeSources.createdAt), desc(placeSources.sourceId));
    const sourcesByPlace = Map.groupBy(
      sourceAssignments,
      assignment => assignment.placeId,
    );

    return rows.map(({latitude, longitude, ...place}) => ({
      ...place,
      coordinates: {latitude, longitude},
      tags: tagsByPlace.get(place.id) ?? [],
      sources: (sourcesByPlace.get(place.id) ?? []).map(assignment => ({
        ...assignment,
        data: placeSource.shape.data.parse(assignment.data),
      })),
    }));
  }),
  sync: api.sync.handler(async ({input, context: {db, google, jobs, config}}) => {
    const predicate = await queryPredicate(input?.query, {db, google});

    if (!config.google.apiKey) {
      throw new ORPCError('SERVICE_UNAVAILABLE', {
        message: 'Configure google.apiKey to sync places.',
      });
    }

    const matches = await db
      .select({id: places.id})
      .from(places)
      .where(predicate)
      .orderBy(places.id);

    if (!matches.length) {
      return {matched: 0, queued: 0, alreadyQueued: 0, jobIds: []};
    }

    const jobIds = await jobs.insert(
      syncQueue,
      matches.map(({id}) => ({
        data: {placeId: id},
        singletonKey: id,
      })),
      {returnId: true},
    );

    if (!jobIds) {
      throw new ORPCError('SERVICE_UNAVAILABLE', {message: 'Could not queue sync jobs.'});
    }

    return {
      matched: matches.length,
      queued: jobIds.length,
      alreadyQueued: matches.length - jobIds.length,
      jobIds,
    };
  }),
  syncStatus: api.syncStatus.handler(async ({input, context: {jobs}}) => {
    const job = await jobs.getJobById(syncQueue, input.jobId);

    if (!job) {
      throw new ORPCError('NOT_FOUND', {message: 'Sync not found or expired.'});
    }

    const {placeId} = syncPayload.parse(job.data);
    const result =
      job.state === 'completed'
        ? z
            .object({status: z.enum(['updated', 'unchanged', 'missing', 'superseded'])})
            .parse(job.output).status
        : null;

    return {
      jobId: job.id,
      placeId,
      state: job.state,
      result,
      error:
        job.state === 'failed' || job.state === 'retry'
          ? 'Sync failed. Check the provider configuration and retry.'
          : null,
    };
  }),
  import: api.import.handler(({input, context}) =>
    enqueueImport(input.input, context, input.tags, input.notes).catch(
      rethrowImportError,
    ),
  ),
  getImportRun: api.getImportRun.handler(({input, context}) =>
    getImportStatus(input.jobId, context).catch(rethrowImportError),
  ),
  listImportRuns: api.listImportRuns.handler(({input, context}) =>
    listImportStatuses(context, input.limit),
  ),
});

const latestRecommendation = sql<Date>`coalesce(
  (select max(${placeSources.createdAt})
   from ${placeSources}
   where ${placeSources.placeId} = ${places.id}),
  ${places.createdAt}
)`;

function placeOrder(sort: PlaceSort) {
  if (sort === 'name') {
    return [asc(places.name), asc(places.id)];
  }

  if (sort === 'recently-recommended') {
    return [desc(latestRecommendation), asc(places.name), asc(places.id)];
  }

  return [desc(places.createdAt), asc(places.name), asc(places.id)];
}

async function resolvePlaceTag(
  db: Pick<Database, 'select'>,
  placeId: string,
  nameOrId: string,
) {
  // Keep both parents alive until the assignment transaction commits.
  const [place] = await db
    .select({id: places.id})
    .from(places)
    .where(eq(places.id, placeId))
    .for('key share');

  if (!place) {
    throw new ORPCError('NOT_FOUND', {message: `Place not found: ${placeId}`});
  }

  const matches = await db
    .select({id: tags.id})
    .from(tags)
    .where(
      or(
        eq(tags.name, nameOrId),
        z.uuid().safeParse(nameOrId).success ? eq(tags.id, nameOrId) : undefined,
      ),
    )
    .for('key share');
  const tag = matches.find(({id}) => id === nameOrId) ?? matches[0];

  if (!tag) {
    throw new ORPCError('NOT_FOUND', {message: `Tag not found: ${nameOrId}`});
  }

  return tag.id;
}

function queryPredicate(
  query: string | undefined,
  context: Pick<Context, 'db' | 'google'>,
) {
  return compilePlaceQuery(query ?? '', context).catch(error => {
    if (error instanceof SearchError) {
      throw new ORPCError('BAD_REQUEST', {
        message: error.message,
        data: {diagnostics: error.diagnostics},
      });
    }

    rethrowGoogleError(error);
  });
}
