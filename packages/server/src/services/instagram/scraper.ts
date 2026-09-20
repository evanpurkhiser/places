import {load} from 'cheerio';
import {z} from 'zod';

import type {InstagramMediaSource, InstagramPostSource} from './media.ts';

const mediaItem = z.object({
  display_uri: z.string().nullish(),
  video_versions: z.array(z.object({url: z.string()})).nullish(),
});
const post = mediaItem.extend({
  user: z.object({username: z.string()}).nullish(),
  taken_at: z.number().nullable().default(null),
  caption: z.object({text: z.string()}).nullish(),
  location: z.object({name: z.string()}).nullish(),
  carousel_media: z.array(mediaItem).nullish(),
});

// Instagram includes embedded media data when serving its browser page.
const headers = {
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-ch-ua': '"Chromium";v="145", "Not:A-Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/145.0.0.0 Safari/537.36',
};

/**
 * Resolve an Instagram post URL into the media URLs consumed by preparation.
 */
export async function scrapeInstagramPost(
  postUrl: string,
  options: {fetch?: typeof fetch; signal?: AbortSignal} = {},
): Promise<InstagramPostSource> {
  const shortcode = instagramShortcode(postUrl);

  const response = await (options.fetch ?? fetch)(
    `https://www.instagram.com/p/${shortcode}/`,
    {headers, signal: options.signal},
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch Instagram post: ${response.status}`);
  }

  return parseInstagramPost(await response.text(), shortcode);
}

/**
 * Validate a post URL and extract its stable identity across Instagram URL forms.
 */
export function instagramShortcode(postUrl: string): string {
  const url = new URL(postUrl);
  const shortcode = url.pathname.match(/^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)\/?$/)?.[1];

  if (
    url.protocol !== 'https:' ||
    !['instagram.com', 'www.instagram.com'].includes(url.hostname) ||
    !shortcode
  ) {
    throw new Error('Expected an Instagram post or reel URL.');
  }

  return shortcode;
}

/**
 * Extract the requested post from Instagram's embedded JSON script payloads.
 */
export function parseInstagramPost(html: string, shortcode: string): InstagramPostSource {
  const $ = load(html);
  const item = $('script[type="application/json"]')
    .toArray()
    .values()
    .map(element => parsePayload($(element).text()))
    .map(payload => findPost(payload, shortcode))
    .find(value => value !== undefined);

  if (!item) {
    throw new Error('Instagram media info missing from page.');
  }

  const data = post.parse(item);
  const metadata = {
    externalId: shortcode,
    username: data.user?.username ?? null,
    postedAt:
      data.taken_at === null ? null : new Date(data.taken_at * 1000).toISOString(),
    thumbnailUrl: data.display_uri ?? data.carousel_media?.[0]?.display_uri ?? null,
    caption: data.caption?.text ?? '',
    location: data.location?.name ?? null,
  };
  return {...metadata, media: (data.carousel_media ?? [data]).map(resolveMedia)};
}

/**
 * Prefer a video's playable URL over its image thumbnail.
 */
function resolveMedia(item: z.infer<typeof mediaItem>): InstagramMediaSource {
  const video = item.video_versions?.[0];

  if (video) {
    return {kind: 'video', url: video.url};
  }

  if (item.display_uri) {
    return {kind: 'image', url: item.display_uri};
  }

  throw new Error('Instagram post has no supported media.');
}

/**
 * Ignore script payloads that are not valid JSON.
 */
function parsePayload(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Find the requested shortcode in nested payloads, including array entries.
 */
function findPost(
  value: unknown,
  shortcode: string,
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  if (
    'code' in value &&
    value.code === shortcode &&
    ('video_versions' in value || 'carousel_media' in value || 'display_uri' in value)
  ) {
    return value as Record<string, unknown>;
  }

  return Object.values(value)
    .values()
    .map(child => findPost(child, shortcode))
    .find(item => item !== undefined);
}
