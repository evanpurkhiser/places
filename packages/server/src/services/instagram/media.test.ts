import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import type {FFmpeg} from './ffmpeg.ts';
import {prepareInstagramMedia} from './media.ts';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'instagram-test-'));
});
afterEach(async () => {
  await rm(root, {recursive: true, force: true});
});

/**
 * Prepare media using real temporary files and fake external providers.
 */
function harness(hasAudio = true) {
  const ffmpeg = {
    probe: vi.fn<FFmpeg['probe']>().mockResolvedValue({durationSeconds: 30, hasAudio}),
    audio: vi.fn<FFmpeg['audio']>().mockResolvedValue(Buffer.from('audio')),
    image: vi
      .fn<FFmpeg['image']>()
      .mockImplementation((_input, timestamp) =>
        Promise.resolve(Buffer.from(`jpeg-${timestamp}`)),
      ),
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() => Promise.resolve(new Response('downloaded media')));
  const transcribe = vi.fn().mockResolvedValue([{start: 1, end: 3, text: 'A cafe'}]);
  const dependencies = {ffmpeg, fetch: fetcher, transcribe};
  const prepare = (signal?: AbortSignal) =>
    prepareInstagramMedia(
      {kind: 'video', caption: 'A cafe', url: 'https://cdn.example/video'},
      dependencies,
      {temporaryRoot: root, signal},
    );
  return {ffmpeg, fetcher, transcribe, dependencies, prepare};
}

describe('Instagram media session', () => {
  it('cleans up aborted preparation before making network requests', async () => {
    const {prepare, fetcher} = harness();
    await expect(prepare(AbortSignal.abort())).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  });

  it('keeps the video until disposal and extracts frames only when requested', async () => {
    const {prepare, ffmpeg, transcribe} = harness();
    const media = await prepare();
    expect(media.kind).toBe('video');
    if (media.kind !== 'video') {
      throw new Error('Expected video');
    }

    expect(media.transcript).toEqual([{start: 1, end: 3, text: 'A cafe'}]);
    expect(ffmpeg.image).not.toHaveBeenCalled();
    expect(transcribe).toHaveBeenCalledOnce();
    const video = ffmpeg.probe.mock.calls[0]![0];
    expect(await readFile(video, 'utf8')).toBe('downloaded media');
    const frames = await media.getFrames([2]);
    expect(frames).toEqual([
      {
        url: `data:image/jpeg;base64,${Buffer.from('jpeg-2').toString('base64')}`,
        timestampSeconds: 2,
      },
    ]);
    expect(await readFile(video, 'utf8')).toBe('downloaded media');
    expect(await readdir(join(video, '..'))).toEqual(['video']);
    expect(transcribe).toHaveBeenCalledWith(
      Buffer.from('audio'),
      expect.any(AbortSignal),
    );

    await media[Symbol.asyncDispose]();
    expect(await readdir(root)).toEqual([]);
    await expect(media.getFrames([2])).rejects.toMatchObject({name: 'AbortError'});
    await media[Symbol.asyncDispose]();
  });

  it('preserves frame order across concurrent requests', async () => {
    const {prepare, ffmpeg} = harness();
    await using media = await prepare();
    if (media.kind !== 'video') {
      throw new Error('Expected video');
    }
    const [first, second] = await Promise.all([
      media.getFrames([2, 1, 2]),
      media.getFrames([1, 2]),
    ]);
    expect(ffmpeg.image).toHaveBeenCalledTimes(5);
    expect(first.map(frame => frame.timestampSeconds)).toEqual([2, 1, 2]);
    expect(second).toEqual([first[1], first[0]]);
  });

  it('handles silent videos without invoking audio extraction or transcription', async () => {
    const {prepare, ffmpeg, transcribe} = harness(false);
    await using media = await prepare();
    expect(media).toMatchObject({kind: 'video', transcript: []});
    expect(ffmpeg.audio).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('preserves carousel images in memory without temporary files', async () => {
    const {dependencies, ffmpeg, transcribe, fetcher} = harness();
    fetcher.mockResolvedValueOnce(
      new Response('first image', {headers: {'content-type': 'image/jpeg'}}),
    );
    fetcher.mockResolvedValueOnce(
      new Response('second image', {headers: {'content-type': 'image/webp'}}),
    );
    {
      await using media = await prepareInstagramMedia(
        {
          kind: 'carousel',
          caption: 'Cafes',
          urls: ['https://cdn.example/1', 'https://cdn.example/2'],
        },
        dependencies,
        {temporaryRoot: join(root, 'nonexistent')},
      );
      expect(media.kind).toBe('carousel');
      if (media.kind !== 'carousel') {
        throw new Error('Expected carousel');
      }
      expect(media.images).toHaveLength(2);
      expect(media.images).toEqual([
        {
          url: `data:image/jpeg;base64,${Buffer.from('first image').toString('base64')}`,
          timestampSeconds: null,
        },
        {
          url: `data:image/webp;base64,${Buffer.from('second image').toString('base64')}`,
          timestampSeconds: null,
        },
      ]);
      expect(ffmpeg.image).not.toHaveBeenCalled();
      expect(ffmpeg.probe).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
    }
    expect(await readdir(root)).toEqual([]);
  });

  it.each(['download', 'probe', 'audio', 'transcribe'])(
    'cleans up when %s preparation fails',
    async stage => {
      const {prepare, ffmpeg, fetcher, transcribe} = harness();
      const failure = new Error('Provider failed');
      if (stage === 'download') {
        fetcher.mockRejectedValue(failure);
      }
      if (stage === 'probe') {
        ffmpeg.probe.mockRejectedValue(failure);
      }
      if (stage === 'audio') {
        ffmpeg.audio.mockRejectedValue(failure);
      }
      if (stage === 'transcribe') {
        transcribe.mockRejectedValue(failure);
      }
      await expect(prepare()).rejects.toThrow('Provider failed');
      expect(await readdir(root)).toEqual([]);
    },
  );

  it('waits for in-flight extraction to settle before removing files', async () => {
    const {prepare, ffmpeg} = harness();
    const media = await prepare();
    if (media.kind !== 'video') {
      throw new Error('Expected video');
    }
    ffmpeg.image.mockImplementation(
      (_input, _time, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), {once: true});
        }),
    );
    const pending = media.getFrames([2]);
    const rejection = expect(pending).rejects.toMatchObject({name: 'AbortError'});
    await media[Symbol.asyncDispose]();
    await rejection;
    expect(await readdir(root)).toEqual([]);
  });

  it('cleans up when its using scope throws', async () => {
    const {prepare} = harness();
    await expect(
      (async () => {
        await using media = await prepare();
        expect(media.kind).toBe('video');
        throw new Error('Capture failed');
      })(),
    ).rejects.toThrow('Capture failed');
    expect(await readdir(root)).toEqual([]);
  });
});
