import {instagramSourceData} from '@places/common/contract/source';
import {and, eq, sql} from 'drizzle-orm';
import type OpenAI from 'openai';
import {fromDrizzle, type PgBoss} from 'pg-boss';
import {z} from 'zod';

import type {Config, WorkerQueueConfig} from '../config.ts';
import type {Database} from '../db/index.ts';
import {namespaces, sources, tags} from '../db/schema.ts';
import type {GooglePlaces} from '../services/google/index.ts';
import {
  capture,
  createTranscriber,
  instagramShortcode,
  prepareInstagramPost,
  scrapeInstagramPost,
  type CaptureResult,
  type FFmpeg,
} from '../services/instagram/index.ts';

import {
  importPayload as googleImportPayload,
  importQueue as googleImportQueue,
} from './gmaps-import.ts';
import {registerWorker} from './worker.ts';

export interface InstagramImportDependencies {
  db: Database;
  google: GooglePlaces;
  openai: OpenAI;
  ffmpeg: FFmpeg;
  config: Config['instagram'];
}

export const importQueue = 'instagram-import';
export const queueOptions = {
  policy: 'exclusive',
  retryLimit: 3,
  retryDelay: 10,
  retryBackoff: true,
  expireInSeconds: 900,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};
const importPayload = z.object({
  shortcode: z.string().regex(/^[A-Za-z0-9_-]+$/),
  tags: googleImportPayload.shape.tags,
  notes: googleImportPayload.shape.notes,
});
type ImportOptions = Pick<z.infer<typeof importPayload>, 'tags' | 'notes'>;

/**
 * Enqueue one ingestion per shortcode while a matching job is queued or active.
 */
export function enqueueInstagramImport(
  jobs: PgBoss,
  url: string,
  options?: ImportOptions,
) {
  const shortcode = instagramShortcode(url);
  return jobs.send(importQueue, {shortcode, ...options}, {singletonKey: shortcode});
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

    const imports = captured.places.map(place => ({
      data: googleImportPayload.parse({
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
          sourceId: source.id,
          description: place.description,
          data: {evidence: place.evidence, matchReason: place.matchReason},
        },
      }),
    }));
    const jobIds =
      imports.length > 0
        ? await jobs.insert(googleImportQueue, imports, {
            db: fromDrizzle(tx, sql),
            returnId: true,
          })
        : [];

    if (!jobIds || jobIds.length !== imports.length) {
      throw new Error('Some Instagram place imports could not be queued.');
    }

    return {sourceId: source.id, jobIds, unresolved: captured.unresolved, skipped: false};
  });
}

/**
 * Register the Instagram orchestration job with the shared worker runner.
 */
export function registerInstagramImportWorker(
  jobs: PgBoss,
  dependencies: InstagramImportDependencies,
  options: WorkerQueueConfig,
) {
  return registerWorker(jobs, importQueue, options, data => {
    const {shortcode, ...options} = importPayload.parse(data);
    return importInstagramPost(jobs, dependencies, shortcode, options);
  });
}
