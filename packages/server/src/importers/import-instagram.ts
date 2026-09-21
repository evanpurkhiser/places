import {instagramSourceData} from '@places/common/contract/source';
import {and, eq} from 'drizzle-orm';
import type OpenAI from 'openai';
import type {PgBoss} from 'pg-boss';

import type {Config} from '../config.ts';
import type {Database} from '../db/index.ts';
import {namespaces, sources, tags} from '../db/schema.ts';
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
function skipped(sourceId: string) {
  return {
    sourceId,
    jobIds: [] as string[],
    unresolved: [] as CaptureResult['unresolved'],
    skipped: true,
  };
}

/**
 * Capture a new post, then persist its source and dispatch its place imports atomically.
 */
export async function importInstagramPost(
  jobs: PgBoss,
  dependencies: InstagramImportDependencies,
  shortcode: string,
  options: ImportOptions = {tags: []},
) {
  const existing = await findSource(dependencies.db, shortcode);

  if (existing) {
    return skipped(existing.id);
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
  tx: Pick<Database, 'insert' | 'execute'>,
  jobs: PgBoss,
  sourceId: string,
  places: CaptureResult['places'],
  alwaysApplyTagIds: string[],
  options: ImportOptions,
) {
  return enqueuePlaceImports(
    jobs,
    tx,
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
      return skipped(existing.id);
    }

    const jobIds = await enqueueCapturedPlaces(
      tx,
      jobs,
      source.id,
      captured.places,
      alwaysApplyTagIds,
      options,
    );

    const output = {
      sourceId: source.id,
      jobIds,
      unresolved: captured.unresolved,
      skipped: false,
    };

    return output;
  });
}
