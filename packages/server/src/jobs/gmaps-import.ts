import {eq} from 'drizzle-orm';
import type {PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {Database} from '../db/index.ts';
import {places} from '../db/schema.ts';
import type {GooglePlaces} from '../services/google/index.ts';

export const importQueue = 'gmaps-import';
export const queueOptions = {
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 60,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};
export const importPayload = z.object({googlePlaceId: z.string().min(1)});

export async function importPlace(
  db: Database,
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

export function registerImportWorker(boss: PgBoss, db: Database, google: GooglePlaces) {
  return boss.work(importQueue, {batchSize: 1}, ([job]) => {
    const {googlePlaceId} = importPayload.parse(job!.data);

    return importPlace(db, google, googlePlaceId);
  });
}
