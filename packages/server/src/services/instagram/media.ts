import {createWriteStream} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';

import type {FFmpeg} from './ffmpeg.ts';
import type {TranscriptSegment} from './transcribing.ts';

export type MediaImage = {url: string; timestampSeconds: number | null};

type PostMetadata = {caption: string; location?: string | null};

/**
 * Resolved Instagram media URLs and post metadata used to prepare a capture session.
 */
export type InstagramMediaSource = PostMetadata &
  ({kind: 'video'; url: string} | {kind: 'carousel'; urls: string[]});

/**
 * Prepared media consumed by capture. Keep its using scope open throughout capture
 * so video frames remain available; disposal releases the session's resources.
 */
export type InstagramMedia = InstagramVideo | InstagramCarousel;

/**
 * A video session with timestamped transcription and on-demand frame extraction.
 */
export type InstagramVideo = PostMetadata &
  AsyncDisposable & {
    kind: 'video';
    durationSeconds: number;
    transcript: TranscriptSegment[];
    getFrames(timestamps: number[], signal?: AbortSignal): Promise<MediaImage[]>;
  };

/**
 * A carousel session containing downloaded images in post order.
 */
export type InstagramCarousel = PostMetadata &
  AsyncDisposable & {
    kind: 'carousel';
    images: MediaImage[];
  };

interface MediaDependencies {
  ffmpeg: FFmpeg;
  transcribe: (audio: Buffer, signal?: AbortSignal) => Promise<TranscriptSegment[]>;
  fetch?: typeof fetch;
}

/**
 * Download a resolved post into an owned session, cleaning up on preparation failure.
 */
export async function prepareInstagramMedia(
  source: InstagramMediaSource,
  dependencies: MediaDependencies,
  options: {temporaryRoot?: string; signal?: AbortSignal} = {},
): Promise<InstagramMedia> {
  options.signal?.throwIfAborted();
  const metadata = {caption: source.caption, location: source.location ?? null};
  const fetcher = dependencies.fetch ?? fetch;

  if (source.kind === 'carousel') {
    const images = await prepareCarousel(source.urls, fetcher, options.signal);
    return {
      kind: 'carousel',
      ...metadata,
      images,
      /**
       * Carousel bytes are owned in memory and need no external cleanup.
       */
      async [Symbol.asyncDispose]() {},
    };
  }

  const directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), 'instagram-'));
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const frames = new Set<Promise<MediaImage>>();
  const video = join(directory, 'video');

  /**
   * Cancel processing and wait for pending frames before deleting session files.
   */
  async function dispose() {
    controller.abort();
    await Promise.allSettled(frames);
    await rm(directory, {recursive: true, force: true});
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
        .then(bytes => image(bytes, timestamp))
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
    const response = await fetchMedia(source.url, fetcher, signal);
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
      kind: 'video',
      ...metadata,
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
function image(
  bytes: Buffer,
  timestampSeconds: number | null,
  contentType = 'image/jpeg',
): MediaImage {
  return {
    url: `data:${contentType};base64,${bytes.toString('base64')}`,
    timestampSeconds,
  };
}

/**
 * Download carousel images in their original format and order.
 */
async function prepareCarousel(
  urls: string[],
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  const images: MediaImage[] = [];

  for (const url of urls) {
    const response = await fetchMedia(url, fetcher, signal);
    const bytes = Buffer.from(await response.arrayBuffer());
    images.push(image(bytes, null, response.headers.get('content-type') ?? 'image/jpeg'));
  }

  return images;
}
