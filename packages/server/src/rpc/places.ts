import {implement, ORPCError} from '@orpc/server';
import {contract} from '@places/common/contract';
import {and, desc, eq, getTableColumns, or, sql} from 'drizzle-orm';
import {z} from 'zod';

import type {Database} from '../db/index.ts';
import {places, placeTags, tags} from '../db/schema.ts';
import {enqueueImport, getImportStatus} from '../imports/index.ts';

import type {Context} from './context.ts';

const api = implement(contract.places).$context<Context>();

export const placeRouter = api.router({
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
  list: api.list.handler(async ({context: {db}}) => {
    const rows = await db
      .select({
        ...getTableColumns(places),
        latitude: sql<number>`ST_Y(${places.coordinates}::geometry)`,
        longitude: sql<number>`ST_X(${places.coordinates}::geometry)`,
      })
      .from(places)
      .orderBy(desc(places.createdAt), desc(places.id));

    return rows.map(({latitude, longitude, ...place}) => ({
      ...place,
      coordinates: {latitude, longitude},
    }));
  }),
  import: api.import.handler(({input, context}) =>
    enqueueImport(input.input, context, input.tags, input.notes),
  ),
  importStatus: api.importStatus.handler(({input, context}) =>
    getImportStatus(input.jobId, context),
  ),
});

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
