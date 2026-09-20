import {describe, expect, it, vi} from 'vitest';

import {readFile} from 'node:fs/promises';

import {parseInstagramPost, scrapeInstagramPost} from './scraper.ts';

/**
 * Read captured Instagram payloads used by the scraper tests.
 */
function fixture(kind: string) {
  return readFile(new URL(`./fixtures/instagram-${kind}.html`, import.meta.url), 'utf8');
}

describe('Instagram scraper', () => {
  it('extracts video URLs and caption from the captured post', async () => {
    const result = parseInstagramPost(await fixture('video'), 'DbqWSEoBpPD');
    expect(result).toMatchObject({
      caption: expect.stringContaining('field study coffee'),
    });
    expect(result.media).toEqual([
      {kind: 'video', url: expect.stringMatching(/^https:\/\//)},
    ]);
  });

  it('extracts carousel images in post order', async () => {
    const html = await fixture('carousel');
    const result = parseInstagramPost(html, 'DJS2jZXptzr');
    expect(result).toMatchObject({
      caption: expect.stringContaining('Tiffany and Rick Johnson'),
    });
    expect(result.media).toHaveLength(6);
    expect(
      result.media.every(
        item => item.kind === 'image' && item.url.startsWith('https://'),
      ),
    ).toBe(true);
    const positions = result.media.map(item => html.indexOf(item.url));
    expect(positions).toEqual(positions.toSorted((a, b) => a - b));
  });

  it('preserves mixed carousel order and selects video URLs instead of thumbnails', async () => {
    const result = parseInstagramPost(await fixture('mixed'), 'Db3f4NkHBiW');
    expect(result.media.map(item => item.kind)).toEqual([
      'video',
      'image',
      'image',
      'image',
      'image',
      'image',
      'image',
      'video',
      'image',
      'image',
      'image',
      'image',
      'image',
    ]);
    expect(
      result.media
        .filter(item => item.kind === 'video')
        .every(item => new URL(item.url).pathname.endsWith('.mp4')),
    ).toBe(true);
    expect(result).toMatchObject({
      caption: 'new york for design freaks!!!!!!!',
      location: 'Brooklyn, New York',
    });
  });

  it('normalizes a single image into the same post shape', () => {
    expect(
      parseInstagramPost(
        '<script type="application/json">{"code":"Photo","display_uri":"https://cdn.example/photo.jpg"}</script>',
        'Photo',
      ),
    ).toEqual({
      caption: '',
      location: null,
      media: [{kind: 'image', url: 'https://cdn.example/photo.jpg'}],
    });
  });

  it('selects the requested post and tolerates unrelated script data', () => {
    const html = `
      <script type="application/json">invalid JSON</script>
      <script type="application/json">{"code":"Other","video_versions":[{"url":"https://cdn.example/other"}]}</script>
      <script type="application/json">{"nested":[{"code":"Target","caption":null,"location":{"name":"New York"},"video_versions":[{"url":"https://cdn.example/video"}]}]}</script>
    `;
    expect(parseInstagramPost(html, 'Target')).toEqual({
      media: [{kind: 'video', url: 'https://cdn.example/video'}],
      caption: '',
      location: 'New York',
    });
  });

  it('rejects pages without the requested media', async () => {
    expect(() => parseInstagramPost('<html>Login required</html>', 'Missing')).toThrow(
      'missing from page',
    );
    const html = await fixture('video');
    expect(() => parseInstagramPost(html, 'Different')).toThrow('missing from page');
  });

  it.each(['p', 'reel', 'tv'])(
    'fetches a canonical post URL from a %s link',
    async path => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(await fixture('video')));
      const signal = new AbortController().signal;
      const result = await scrapeInstagramPost(
        `https://instagram.com/${path}/DbqWSEoBpPD/?igsh=tracking`,
        {fetch: fetcher, signal},
      );
      expect(fetcher).toHaveBeenCalledWith('https://www.instagram.com/p/DbqWSEoBpPD/', {
        headers: expect.objectContaining({'user-agent': expect.any(String)}),
        signal,
      });
      expect(result.media[0]?.kind).toBe('video');
    },
  );

  it.each([
    'https://example.com/p/Abc/',
    'https://instagram.com/profile/',
    'http://instagram.com/p/Abc/',
  ])('rejects invalid post URL %s before fetching', async url => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(scrapeInstagramPost(url, {fetch: fetcher})).rejects.toThrow(
      'Instagram post or reel URL',
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('propagates HTTP failures', async () => {
    await expect(
      scrapeInstagramPost('https://instagram.com/p/Abc/', {
        fetch: () => Promise.resolve(new Response('', {status: 429})),
      }),
    ).rejects.toThrow('429');
  });

  it('propagates cancellation', async () => {
    const signal = AbortSignal.abort();
    await expect(
      scrapeInstagramPost('https://instagram.com/p/Abc/', {
        signal,
        fetch: (_url, options) => {
          options?.signal?.throwIfAborted();
          return Promise.resolve(new Response(''));
        },
      }),
    ).rejects.toMatchObject({name: 'AbortError'});
  });
});
