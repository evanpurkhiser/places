import {instagramSourceData} from '@places/common/contract/source';
import {and, eq, isNull, sql} from 'drizzle-orm';
import type OpenAI from 'openai';
import type {PgBoss} from 'pg-boss';

import type {Config} from '../config.ts';
import type {Database} from '../db/index.ts';
import {
  namespaces,
  places,
  placeSaves,
  placeSources,
  sources,
  tags,
} from '../db/schema.ts';
import {enqueuePlaceImports} from '../jobs/gmaps-import.ts';
import type {GooglePlaces} from '../services/google/index.ts';
import {
  capture,
  createTranscriber,
  prepareInstagramPost,
  scrapeInstagramPost,
  type CaptureResult,
  type FFmpeg,
} from '../services/instagram/index.ts';

import {lockImportSource} from './place-saves.ts';
import {recordImportCapture, type ImportRunIdentity} from './runs.ts';
import type {ImportOptions} from './types.ts';

export interface InstagramImportDependencies {
  db: Database;
  google: GooglePlaces;
  openai: OpenAI;
  ffmpeg: FFmpeg;
  config: Config['instagram'];
}

/**
 * Use a canonical post URL independent of the incoming share-link format.
 */
function postUrl(externalId: string) {
  return `https://www.instagram.com/p/${externalId}/`;
}

/**
 * Find completed capture and dispatch by its provider identity.
 */
async function findSource(db: Pick<Database, 'select'>, externalId: string) {
  const [source] = await db
    .select({id: sources.id})
    .from(sources)
    .where(and(eq(sources.type, 'instagram'), eq(sources.externalId, externalId)));
  return source;
}

/**
 * Report an existing ingestion without repeating capture or dispatch.
 */
async function saveExistingSource(
  tx: Pick<Database, 'select' | 'insert' | 'update'>,
  sourceId: string,
  run: ImportRunIdentity | undefined,
) {
  const output = {
    sourceId,
    jobIds: [] as string[],
    unresolved: [] as CaptureResult['unresolved'],
    skipped: true,
  };

  if (!run) {
    return output;
  }

  await lockImportSource(tx, sourceId);
  await tx
    .insert(placeSaves)
    .select(
      tx
        .select({
          placeId: placeSources.placeId,
          userId: sql<string>`${run.requestedByUserId}::uuid`.as('user_id'),
          savedAt: sql<Date>`now()`.as('saved_at'),
        })
        .from(placeSources)
        .innerJoin(places, eq(placeSources.placeId, places.id))
        .where(and(eq(placeSources.sourceId, sourceId), isNull(places.deletedAt)))
        .orderBy(placeSources.placeId),
    )
    .onConflictDoNothing();
  await recordImportCapture(tx, run.id, output);

  return output;
}

/**
 * Capture a new post, then persist its source and dispatch its place imports atomically.
 */
export async function importInstagramPost(
  jobs: PgBoss,
  dependencies: InstagramImportDependencies,
  shortcode: string,
  options: ImportOptions = {tags: []},
  run?: ImportRunIdentity,
) {
  const existing = await findSource(dependencies.db, shortcode);

  if (existing) {
    return dependencies.db.transaction(tx => saveExistingSource(tx, existing.id, run));
  }

  const {captured, alwaysApplyTagIds} = await capturePost(
    dependencies,
    postUrl(shortcode),
  );
  return dispatchPlaces(
    dependencies.db,
    jobs,
    shortcode,
    captured,
    alwaysApplyTagIds,
    options,
    run,
  );
}

/**
 * Load classification inputs and keep prepared media alive through capture.
 */
async function capturePost(
  {db, google, openai, ffmpeg, config}: InstagramImportDependencies,
  url: string,
) {
  const [catalogTags, catalogNamespaces] = await Promise.all([
    db.select().from(tags),
    db.select().from(namespaces),
  ]);
  const alwaysApplyTagIds = config.alwaysApplyTags.map(name => {
    const tag = catalogTags.find(tag => tag.name === name);

    if (!tag) {
      throw new Error(`Instagram automatic tag does not exist: ${name}`);
    }

    return tag.id;
  });

  const signal = AbortSignal.timeout(config.capture.timeoutMs);
  const source = await scrapeInstagramPost(url, {signal});
  await using post = await prepareInstagramPost(
    source,
    {
      ffmpeg,
      transcribe: createTranscriber(openai),
    },
    {signal},
  );
  const captured = await capture(
    {openai, google},
    post,
    {tags: catalogTags, namespaces: catalogNamespaces},
    {
      ...config.capture,
      excludedTags: [...new Set([...config.excludedTags, ...config.alwaysApplyTags])],
      excludedNamespaces: config.excludedNamespaces,
      requiredNamespaces: config.requiredNamespaces,
    },
    signal,
  );
  return {captured, alwaysApplyTagIds};
}

function enqueueCapturedPlaces(
  tx: Pick<Database, 'insert' | 'execute' | 'select'>,
  jobs: PgBoss,
  sourceId: string,
  places: CaptureResult['places'],
  alwaysApplyTagIds: string[],
  options: ImportOptions,
  requestedByUserId: string | undefined,
) {
  return enqueuePlaceImports(
    jobs,
    tx,
    requestedByUserId,
    places.map(place => ({
      googlePlaceId: place.googlePlaceId,
      tags: [
        ...new Map([
          ...[...place.tagIds, ...alwaysApplyTagIds].map(
            tagId => [tagId, {tagId}] as const,
          ),
          ...options.tags.map(tag => [tag.tagId, tag] as const),
        ]).values(),
      ],
      notes: options.notes,
      source: {
        sourceId,
        description: place.description,
        data: {evidence: place.evidence, matchReason: place.matchReason},
      },
    })),
  );
}

/**
 * Commit the source and all child jobs together; failed dispatch leaves ingestion retryable.
 */
function dispatchPlaces(
  db: Database,
  jobs: PgBoss,
  externalId: string,
  captured: CaptureResult,
  alwaysApplyTagIds: string[],
  options: ImportOptions,
  run?: ImportRunIdentity,
) {
  return db.transaction(async tx => {
    const {description, caption, username, postedAt, thumbnailUrl} = captured.source;
    const [source] = await tx
      .insert(sources)
      .values({
        type: 'instagram',
        externalId,
        url: postUrl(externalId),
        description,
        data: instagramSourceData.parse({caption, username, postedAt, thumbnailUrl}),
      })
      .onConflictDoNothing({target: [sources.type, sources.externalId]})
      .returning({id: sources.id});

    if (!source) {
      const existing = await findSource(tx, externalId);
      if (!existing) {
        throw new Error('Instagram source disappeared during import. Retry the import.');
      }
      return saveExistingSource(tx, existing.id, run);
    }

    const jobIds = await enqueueCapturedPlaces(
      tx,
      jobs,
      source.id,
      captured.places,
      alwaysApplyTagIds,
      options,
      run?.requestedByUserId,
    );

    const output = {
      sourceId: source.id,
      jobIds,
      unresolved: captured.unresolved,
      captured,
      skipped: false,
    };

    if (run) {
      await recordImportCapture(tx, run.id, output);
    }

    return output;
  });
}
