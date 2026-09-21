import type {PlaceSourceInput} from '@places/common/contract/source';
import {eq, sql} from 'drizzle-orm';

import type {Database} from '../db/index.ts';
import {places, placeSources, placeTags} from '../db/schema.ts';
import type {GooglePlaces} from '../services/google/index.ts';

import type {ImportOptions} from './types.ts';

type ImportAssignment = ImportOptions['tags'][number];

async function savePlace(
  db: Pick<Database, 'select' | 'insert'>,
  google: GooglePlaces,
  googlePlaceId: string,
  notes?: string,
) {
  const [existing] = await db
    .select({id: places.id})
    .from(places)
    .where(eq(places.googlePlaceId, googlePlaceId));

  if (existing) {
    return {placeId: existing.id, created: false};
  }

  const details = await google.getMetadata(googlePlaceId);
  const [inserted] = await db
    .insert(places)
    .values({
      googlePlaceId: details.id,
      name: details.displayName.text,
      userNote: notes || null,
      formattedAddress: details.formattedAddress,
      timeZone: details.timeZone,
      hoursWeeklyOpen: details.hoursWeeklyOpen,
      businessStatus: details.businessStatus,
      lastSync: new Date(),
      googleMapsUrl: details.googleMapsUri,
      coordinates: `SRID=4326;POINT(${details.location.longitude} ${details.location.latitude})`,
    })
    .onConflictDoNothing({target: places.googlePlaceId})
    .returning({id: places.id});

  if (inserted) {
    return {placeId: inserted.id, created: true};
  }

  const [canonical] = await db
    .select({id: places.id})
    .from(places)
    .where(eq(places.googlePlaceId, details.id));

  if (!canonical) {
    throw new Error('Place disappeared during import. Retry the import.');
  }

  return {placeId: canonical.id, created: false};
}

export function importPlace(
  db: Database,
  google: GooglePlaces,
  googlePlaceId: string,
  tags: ImportAssignment[] = [],
  notes?: string,
  source?: PlaceSourceInput,
) {
  return db.transaction(async tx => {
    const {placeId, created} = await savePlace(tx, google, googlePlaceId, notes);

    if (created) {
      await applyInitialTags(tx, placeId, tags);
    }

    if (source) {
      await attachSource(tx, placeId, source);
    }

    return {placeIds: [placeId]};
  });
}

/**
 * Apply tag assignments when an import creates a place.
 */
async function applyInitialTags(
  tx: Pick<Database, 'insert'>,
  placeId: string,
  tags: ImportAssignment[],
) {
  const bareTags = tags.filter(({note}) => note === undefined);
  const annotatedTags = tags.filter(({note}) => note !== undefined);

  if (bareTags.length > 0) {
    await tx
      .insert(placeTags)
      .values(bareTags.map(({tagId}) => ({placeId, tagId})))
      .onConflictDoNothing();
  }

  if (annotatedTags.length > 0) {
    await tx
      .insert(placeTags)
      .values(
        annotatedTags.map(({tagId, note}) => ({
          placeId,
          tagId,
          note: note === '' ? null : note,
        })),
      )
      .onConflictDoUpdate({
        target: [placeTags.placeId, placeTags.tagId],
        set: {note: sql`excluded.note`},
      });
  }
}

/**
 * Upsert a recommendation, preserving omitted fields and clearing explicit nulls.
 */
async function attachSource(
  db: Pick<Database, 'insert'>,
  placeId: string,
  source: PlaceSourceInput,
) {
  const {sourceId, description, data} = source;
  const insert = db.insert(placeSources).values({placeId, sourceId, description, data});

  if (description === undefined && data === undefined) {
    await insert.onConflictDoNothing();
    return;
  }

  await insert.onConflictDoUpdate({
    target: [placeSources.placeId, placeSources.sourceId],
    set: {description, data},
  });
}
