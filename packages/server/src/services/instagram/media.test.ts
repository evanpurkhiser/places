import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {mkdtemp, readdir, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import type {FFmpeg} from './ffmpeg.ts';
import {prepareInstagramPost, type InstagramPostSource} from './media.ts';

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
    prepareInstagramPost(
      {caption: 'A cafe', media: [{kind: 'video', url: 'https://cdn.example/video'}]},
      dependencies,
      {temporaryRoot: root, signal},
    );
  return {ffmpeg, fetcher, transcribe, dependencies, prepare};
}

describe('Instagram post preparation', () => {
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
    const post = await prepare();
    const media = post.media[0]!;
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

    await post[Symbol.asyncDispose]();
    expect(await readdir(root)).toEqual([]);
    await expect(media.getFrames([2])).rejects.toMatchObject({name: 'AbortError'});
    await post[Symbol.asyncDispose]();
  });

  it('preserves frame order across concurrent requests', async () => {
    const {prepare, ffmpeg} = harness();
    await using post = await prepare();
    const media = post.media[0]!;
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
    await using post = await prepare();
    const media = post.media[0]!;
    expect(media).toMatchObject({kind: 'video', transcript: []});
    expect(ffmpeg.audio).not.toHaveBeenCalled();
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('prepares image-only posts in memory', async () => {
    const {dependencies, ffmpeg, transcribe, fetcher} = harness();
    fetcher.mockResolvedValueOnce(
      new Response('first image', {headers: {'content-type': 'image/jpeg'}}),
    );
    fetcher.mockResolvedValueOnce(
      new Response('second image', {headers: {'content-type': 'image/webp'}}),
    );
    {
      await using post = await prepareInstagramPost(
        {
          caption: 'Cafes',
          media: [
            {kind: 'image', url: 'https://cdn.example/1'},
            {kind: 'image', url: 'https://cdn.example/2'},
          ],
        },
        dependencies,
        {temporaryRoot: join(root, 'nonexistent')},
      );
      expect(post.media).toEqual([
        {
          id: 'media-1',
          kind: 'image',
          image: `data:image/jpeg;base64,${Buffer.from('first image').toString('base64')}`,
        },
        {
          id: 'media-2',
          kind: 'image',
          image: `data:image/webp;base64,${Buffer.from('second image').toString('base64')}`,
        },
      ]);
      expect(ffmpeg.image).not.toHaveBeenCalled();
      expect(ffmpeg.probe).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
    }
    expect(await readdir(root)).toEqual([]);
  });

  it('prepares mixed media with distinct video sources and cleans up both', async () => {
    const {dependencies, ffmpeg, fetcher, transcribe} = harness();
    const source: InstagramPostSource = {
      caption: 'Mixed post',
      media: [
        {kind: 'video', url: 'https://cdn.example/first.mp4'},
        {kind: 'image', url: 'https://cdn.example/image.jpg'},
        {kind: 'video', url: 'https://cdn.example/second.mp4'},
      ],
    };
    fetcher.mockImplementation(url =>
      Promise.resolve(
        new Response(String(url), {headers: {'content-type': 'image/jpeg'}}),
      ),
    );
    ffmpeg.image.mockImplementation(async (path, timestamp) =>
      Buffer.from(`${await readFile(path, 'utf8')} at ${timestamp}`),
    );
    const post = await prepareInstagramPost(source, dependencies, {temporaryRoot: root});
    expect(post.media.map(item => item.kind)).toEqual(
      source.media.map(item => item.kind),
    );
    expect(post.media.map(item => item.id)).toEqual(
      source.media.map((_, index) => `media-${index + 1}`),
    );
    const videos = post.media.filter(item => item.kind === 'video');
    expect(videos.map(video => video.id)).toEqual(['media-1', 'media-3']);
    expect(transcribe).toHaveBeenCalledTimes(2);
    const [first, second] = await Promise.all(videos.map(video => video.getFrames([1])));
    expect(first![0]!.url).not.toEqual(second![0]!.url);
    expect(new Set(ffmpeg.probe.mock.calls.map(call => call[0])).size).toBe(2);
    await post[Symbol.asyncDispose]();
    expect(await readdir(root)).toEqual([]);
  });

  it.each(['image', 'video'] as const)(
    'cleans up earlier videos when a later %s fails',
    async kind => {
      const {dependencies, fetcher, ffmpeg} = harness();
      fetcher.mockImplementation(url =>
        String(url).endsWith('/first')
          ? Promise.resolve(new Response('video'))
          : Promise.reject(new Error('Later download failed')),
      );
      await expect(
        prepareInstagramPost(
          {
            caption: '',
            media: [
              {kind: 'video', url: 'https://cdn.example/first'},
              {kind, url: 'https://cdn.example/second'},
            ],
          },
          dependencies,
          {temporaryRoot: root},
        ),
      ).rejects.toThrow('Later download failed');
      expect(ffmpeg.probe).toHaveBeenCalledOnce();
      expect(await readdir(root)).toEqual([]);
    },
  );

  it('waits for concurrent preparation before cleaning up after a failure', async () => {
    const {dependencies, fetcher, transcribe} = harness();
    const transcription =
      Promise.withResolvers<Array<{start: number; end: number; text: string}>>();
    transcribe.mockReturnValue(transcription.promise);
    fetcher.mockImplementation(url =>
      String(url).endsWith('/video')
        ? Promise.resolve(new Response('video'))
        : Promise.reject(new Error('Image failed')),
    );
    const pending = prepareInstagramPost(
      {
        caption: '',
        media: [
          {kind: 'video', url: 'https://cdn.example/video'},
          {kind: 'image', url: 'https://cdn.example/image'},
        ],
      },
      dependencies,
      {temporaryRoot: root},
    );
    const rejection = expect(pending).rejects.toThrow('Image failed');
    await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readdir(root)).toHaveLength(1);
    transcription.resolve([]);
    await rejection;
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
    const post = await prepare();
    const media = post.media[0]!;
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
    await post[Symbol.asyncDispose]();
    await rejection;
    expect(await readdir(root)).toEqual([]);
  });

  it('cleans up when its using scope throws', async () => {
    const {prepare} = harness();
    await expect(
      (async () => {
        await using post = await prepare();
        const media = post.media[0]!;
        expect(media.kind).toBe('video');
        throw new Error('Capture failed');
      })(),
    ).rejects.toThrow('Capture failed');
    expect(await readdir(root)).toEqual([]);
  });
});
