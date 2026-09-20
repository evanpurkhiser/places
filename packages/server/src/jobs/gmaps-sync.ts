import {eq, getTableColumns, sql} from 'drizzle-orm';
import type {PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {WorkerQueueConfig} from '../config.ts';
import type {Database} from '../db/index.ts';
import {places} from '../db/schema.ts';
import type {GooglePlaces} from '../services/google/index.ts';

import {registerWorker} from './worker.ts';

export const syncQueue = 'gmaps-sync';
export const syncPayload = z.object({placeId: z.uuid()});

export async function syncPlace(db: Database, google: GooglePlaces, placeId: string) {
  const [before] = await db.select().from(places).where(eq(places.id, placeId));

  if (!before) {
    return {placeId, status: 'missing' as const};
  }

  const details = await google.getMetadata(before.googlePlaceId);

  return db.transaction(async tx => {
    const [current] = await tx
      .select({
        ...getTableColumns(places),
        latitude: sql<number>`ST_Y(${places.coordinates}::geometry)`,
        longitude: sql<number>`ST_X(${places.coordinates}::geometry)`,
      })
      .from(places)
      .where(eq(places.id, placeId))
      .for('update');

    if (!current) {
      return {placeId, status: 'missing' as const};
    }

    // A refresh which completed while this request was in flight takes precedence.
    if (
      current.googlePlaceId !== before.googlePlaceId ||
      current.lastSync?.getTime() !== before.lastSync?.getTime()
    ) {
      return {placeId, status: 'superseded' as const};
    }

    const values = {
      googlePlaceId: details.id,
      name: details.displayName.text,
      formattedAddress: details.formattedAddress,
      googleMapsUrl: details.googleMapsUri,
      timeZone: details.timeZone,
      hoursWeeklyOpen: details.hoursWeeklyOpen,
      businessStatus: details.businessStatus,
    };
    const changed =
      Object.entries(values).some(
        ([key, value]) =>
          JSON.stringify(current[key as keyof typeof values]) !== JSON.stringify(value),
      ) ||
      current.latitude !== details.location.latitude ||
      current.longitude !== details.location.longitude;

    // The unique Google ID constraint makes collisions roll back the entire refresh.
    await tx
      .update(places)
      .set({
        ...(changed
          ? {
              ...values,
              coordinates: `SRID=4326;POINT(${details.location.longitude} ${details.location.latitude})`,
            }
          : {}),
        lastSync: new Date(),
        updatedAt: changed ? new Date() : current.updatedAt,
      })
      .where(eq(places.id, placeId));

    return {placeId, status: changed ? ('updated' as const) : ('unchanged' as const)};
  });
}

interface WorkerDependencies {
  db: Database;
  google: GooglePlaces;
}

/**
 * Register the worker with its dependencies and queue settings.
 */
export function registerSyncWorker(
  jobs: PgBoss,
  {db, google}: WorkerDependencies,
  options: WorkerQueueConfig,
) {
  return registerWorker(jobs, syncQueue, options, data => {
    const {placeId} = syncPayload.parse(data);

    return syncPlace(db, google, placeId);
  });
}
