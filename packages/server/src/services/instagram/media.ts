import {createWriteStream} from 'node:fs';
import {mkdtempDisposable} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';

import type {FFmpeg} from './ffmpeg.ts';
import type {TranscriptSegment} from './transcribing.ts';

/**
 * An extracted frame with its timestamp relative to the source video.
 */
export type VideoFrame = {url: string; timestampSeconds: number};

/**
 * Post identity and display metadata supplied by Instagram.
 */
export type InstagramPostMetadata = {
  externalId: string;
  caption: string;
  username: string | null;
  postedAt: string | null;
  thumbnailUrl: string | null;
  location?: string | null;
};

/**
 * A downloadable image or video in an Instagram post.
 */
export type InstagramMediaSource = {kind: 'image' | 'video'; url: string};

/**
 * Resolved post metadata and media URLs in their original order.
 */
export type InstagramPostSource = InstagramPostMetadata & {media: InstagramMediaSource[]};

/**
 * Prepared post consumed by capture. Keep its using scope open throughout capture
 * so video frames remain available; disposal releases all video resources.
 */
export type InstagramPost = InstagramPostMetadata &
  AsyncDisposable & {media: InstagramMedia[]};

/**
 * An identified image or video within a prepared post.
 */
export type InstagramMedia = InstagramVideo | InstagramImage;

/**
 * A video with timestamped transcription and on-demand frame extraction.
 */
export type InstagramVideo = AsyncDisposable & {
  id: string;
  kind: 'video';
  durationSeconds: number;
  transcript: TranscriptSegment[];
  getFrames(timestamps: number[], signal?: AbortSignal): Promise<VideoFrame[]>;
};

/**
 * An image held in memory in its original format.
 */
export type InstagramImage = {id: string; kind: 'image'; image: string};

interface MediaDependencies {
  ffmpeg: FFmpeg;
  transcribe: (audio: Buffer, signal?: AbortSignal) => Promise<TranscriptSegment[]>;
  fetch?: typeof fetch;
}

/**
 * Prepare media concurrently, preserve post order, and own video cleanup.
 */
export async function prepareInstagramPost(
  source: InstagramPostSource,
  dependencies: MediaDependencies,
  options: {temporaryRoot?: string; signal?: AbortSignal} = {},
): Promise<InstagramPost> {
  const resources = new AsyncDisposableStack();

  const pending = source.media.map(async (item, index) => {
    options.signal?.throwIfAborted();
    const id = `media-${index + 1}`;
    return item.kind === 'video'
      ? resources.use(await makeVideo(id, item.url, dependencies, options))
      : makeImage(id, item.url, dependencies.fetch ?? fetch, options.signal);
  });

  try {
    const media = await Promise.all(pending);

    return {
      externalId: source.externalId,
      username: source.username,
      postedAt: source.postedAt,
      thumbnailUrl: source.thumbnailUrl,
      caption: source.caption,
      location: source.location ?? null,
      media,
      /**
       * Release video resources owned by this post.
       */
      [Symbol.asyncDispose]: () => resources.disposeAsync(),
    };
  } catch (error) {
    await Promise.allSettled(pending);
    await resources.disposeAsync();
    throw error;
  }
}

/**
 * Download and transcribe a video, retaining its source for frame requests.
 */
async function makeVideo(
  id: string,
  url: string,
  dependencies: MediaDependencies,
  options: {temporaryRoot?: string; signal?: AbortSignal},
): Promise<InstagramVideo> {
  const directory = await mkdtempDisposable(
    join(options.temporaryRoot ?? tmpdir(), 'instagram-'),
  );
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const frames = new Set<Promise<VideoFrame>>();
  const video = join(directory.path, 'video');

  /**
   * Cancel processing and wait for pending frames before deleting session files.
   */
  async function dispose() {
    controller.abort();
    await Promise.allSettled(frames);
    await directory.remove();
  }

  /**
   * Extract requested frames in order and track processing for session cleanup.
   */
  async function getFrames(timestamps: number[], requestSignal?: AbortSignal) {
    signal.throwIfAborted();
    requestSignal?.throwIfAborted();
    const extractionSignal = requestSignal
      ? AbortSignal.any([signal, requestSignal])
      : signal;

    const pending = timestamps.map(timestamp => {
      const frame = dependencies.ffmpeg
        .image(video, timestamp, extractionSignal)
        .then(bytes => ({
          url: imageDataUrl(bytes, 'image/jpeg'),
          timestampSeconds: timestamp,
        }))
        .finally(() => frames.delete(frame));
      frames.add(frame);
      return frame;
    });

    const result = await Promise.all(pending);
    extractionSignal.throwIfAborted();
    return result;
  }

  try {
    signal.throwIfAborted();
    const response = await fetchMedia(url, dependencies.fetch ?? fetch, signal);
    await pipeline(response.body!, createWriteStream(video), {signal});
    const {durationSeconds, hasAudio} = await dependencies.ffmpeg.probe(video, signal);

    const segments = hasAudio
      ? await dependencies.transcribe(
          await dependencies.ffmpeg.audio(video, signal),
          signal,
        )
      : [];
    signal.throwIfAborted();

    return {
      id,
      kind: 'video',
      durationSeconds,
      transcript: segments,
      getFrames,
      [Symbol.asyncDispose]: dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

/**
 * Fetch media and reject unsuccessful HTTP responses.
 */
async function fetchMedia(url: string, fetcher: typeof fetch, signal?: AbortSignal) {
  const response = await fetcher(url, {signal});

  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('Instagram media download failed.');
  }

  return response;
}

/**
 * Encode image bytes in the data URL format accepted by capture.
 */
function imageDataUrl(bytes: Buffer, contentType: string): string {
  return `data:${contentType};base64,${bytes.toString('base64')}`;
}

/**
 * Download an image directly into memory with its position-based identifier.
 */
async function makeImage(
  id: string,
  url: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<InstagramImage> {
  const response = await fetchMedia(url, fetcher, signal);
  const bytes = Buffer.from(await response.bytes());
  return {
    id,
    kind: 'image',
    image: imageDataUrl(bytes, response.headers.get('content-type') ?? 'image/jpeg'),
  };
}
