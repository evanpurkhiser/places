import {importTag, placeTag} from '@places/common/contract/place';
import {eq, sql} from 'drizzle-orm';
import type {PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {Database} from '../db/index.ts';
import {places, placeTags} from '../db/schema.ts';
import type {GooglePlaces} from '../services/google/index.ts';

export const importQueue = 'gmaps-import';
export const queueOptions = {
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};
const importAssignment = placeTag
  .pick({tagId: true})
  .extend({note: importTag.shape.note});
type ImportAssignment = z.infer<typeof importAssignment>;

export const importPayload = z.object({
  googlePlaceId: z.string().min(1),
  tags: z.array(importAssignment).default([]),
  notes: z.string().optional(),
});

async function savePlace(
  db: Pick<Database, 'select' | 'insert'>,
  google: GooglePlaces,
  googlePlaceId: string,
) {
  const [existing] = await db
    .select({id: places.id})
    .from(places)
    .where(eq(places.googlePlaceId, googlePlaceId));

  if (existing) {
    return {placeIds: [existing.id]};
  }

  const details = await google.get(googlePlaceId);
  const [inserted] = await db
    .insert(places)
    .values({
      googlePlaceId: details.id,
      name: details.displayName.text,
      formattedAddress: details.formattedAddress,
      googleMapsUrl: details.googleMapsUri,
      coordinates: `SRID=4326;POINT(${details.location.longitude} ${details.location.latitude})`,
    })
    .onConflictDoNothing({target: places.googlePlaceId})
    .returning({id: places.id});

  if (inserted) {
    return {placeIds: [inserted.id]};
  }

  const [canonical] = await db
    .select({id: places.id})
    .from(places)
    .where(eq(places.googlePlaceId, details.id));

  if (!canonical) {
    throw new Error('Place disappeared during import. Retry the import.');
  }

  return {placeIds: [canonical.id]};
}

export function importPlace(
  db: Database,
  google: GooglePlaces,
  googlePlaceId: string,
  tags: ImportAssignment[] = [],
  notes?: string,
) {
  return db.transaction(async tx => {
    const result = await savePlace(tx, google, googlePlaceId);

    if (notes !== undefined) {
      await tx
        .update(places)
        .set({userNote: notes === '' ? null : notes})
        .where(eq(places.id, result.placeIds[0]!));
    }

    const bareTags = tags.filter(({note}) => note === undefined);
    const annotatedTags = tags.filter(({note}) => note !== undefined);

    if (bareTags.length > 0) {
      await tx
        .insert(placeTags)
        .values(bareTags.map(({tagId}) => ({placeId: result.placeIds[0]!, tagId})))
        .onConflictDoNothing();
    }

    if (annotatedTags.length > 0) {
      await tx
        .insert(placeTags)
        .values(
          annotatedTags.map(({tagId, note}) => ({
            placeId: result.placeIds[0]!,
            tagId,
            note: note === '' ? null : note,
          })),
        )
        .onConflictDoUpdate({
          target: [placeTags.placeId, placeTags.tagId],
          set: {note: sql`excluded.note`},
        });
    }

    return result;
  });
}

export function registerImportWorker(boss: PgBoss, db: Database, google: GooglePlaces) {
  return boss.work(importQueue, {batchSize: 1}, ([job]) => {
    const {googlePlaceId, tags, notes} = importPayload.parse(job!.data);

    return importPlace(db, google, googlePlaceId, tags, notes);
  });
}
