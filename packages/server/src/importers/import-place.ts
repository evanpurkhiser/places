import type {PlaceSourceInput} from '@places/common/contract/source';
import {eq, sql} from 'drizzle-orm';

import {saveAuditEntry} from '../audit/index.ts';
import type {Database} from '../db/index.ts';
import {places, placeSources, placeTags} from '../db/schema.ts';
import {defaultUserId} from '../db/users.ts';
import type {GooglePlaces} from '../services/google/index.ts';

import type {ImportRunIdentity} from './runs.ts';
import type {ImportOptions} from './types.ts';

type ImportAssignment = ImportOptions['tags'][number];

async function findPlace(db: Pick<Database, 'select'>, googlePlaceId: string) {
  const [place] = await db
    .select({id: places.id, deletedAt: places.deletedAt})
    .from(places)
    .where(eq(places.googlePlaceId, googlePlaceId))
    .for('no key update');

  return place;
}

async function savePlace(
  db: Pick<Database, 'select' | 'insert'>,
  google: GooglePlaces,
  googlePlaceId: string,
  addedByUserId: string | undefined,
  notes?: string,
) {
  const existing = await findPlace(db, googlePlaceId);

  if (existing) {
    return {...existing, created: false as const};
  }

  const details = await google.getMetadata(googlePlaceId);
  const [inserted] = await db
    .insert(places)
    .values({
      googlePlaceId: details.id,
      addedByUserId: addedByUserId ?? defaultUserId(db),
      name: details.displayName.text,
      userNote: notes || null,
      formattedAddress: details.formattedAddress,
      timeZone: details.timeZone,
      hoursWeeklyOpen: details.hoursWeeklyOpen,
      businessStatus: details.businessStatus,
      googleMetadata: details.googleMetadata,
      lastSync: new Date(),
      googleMapsUrl: details.googleMapsUri,
      coordinates: `SRID=4326;POINT(${details.location.longitude} ${details.location.latitude})`,
    })
    .onConflictDoNothing({target: places.googlePlaceId})
    .returning({
      id: places.id,
      deletedAt: places.deletedAt,
      name: places.name,
      userNote: places.userNote,
    });

  if (inserted) {
    return {...inserted, created: true as const};
  }

  const canonical = await findPlace(db, details.id);

  if (!canonical) {
    throw new Error('Place disappeared during import. Retry the import.');
  }

  return {...canonical, created: false as const};
}

export function importPlace(
  db: Database,
  google: GooglePlaces,
  googlePlaceId: string,
  tags: ImportAssignment[] = [],
  notes?: string,
  source?: PlaceSourceInput,
  run?: ImportRunIdentity,
) {
  return db.transaction(async tx => {
    const place = await savePlace(
      tx,
      google,
      googlePlaceId,
      run?.requestedByUserId,
      notes,
    );
    const {id: placeId, deletedAt} = place;

    // Importing a source can discover several places. Keep deleted places hidden
    // until a direct Google Maps import targets the place for restoration.
    if (deletedAt && source) {
      return {placeIds: []};
    }

    if (deletedAt) {
      await tx.update(places).set({deletedAt: null}).where(eq(places.id, placeId));
    }

    if (place.created) {
      await saveAuditEntry(tx, {
        type: 'place.created',
        subject: {type: 'place', id: placeId},
        actor: run
          ? {type: 'user', id: run.requestedByUserId}
          : {type: 'system', id: 'gmaps-import'},
        payload: {name: place.name, userNote: place.userNote, importRunId: run?.id},
      });
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
