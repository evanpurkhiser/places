import {load} from 'cheerio';
import {z} from 'zod';

import type {MediaPostSource, PostMediaSource} from '../media-import/index.ts';

import {parseRedNoteUrl} from './urls.ts';

const headers = {
  'user-agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
};
const links = z.object({url: z.string().nullish()});
const stream = z.record(
  z.string(),
  z.array(z.object({masterUrl: z.string().nullish(), width: z.number().optional()})),
);
const noteSchema = z.object({
  noteId: z.string(),
  type: z.string(),
  title: z.string().nullish(),
  desc: z.string().nullish(),
  time: z.number().int().nonnegative().max(8640000000000000).nullish(),
  user: z.object({nickName: z.string().nullish()}).nullish(),
  cover: links.nullish(),
  imageList: z
    .array(
      links.extend({
        infoList: z.array(links).nullish(),
        livePhoto: z.boolean().nullish(),
        stream: stream.nullish(),
      }),
    )
    .nullish(),
  video: z.object({media: z.object({stream: stream.nullish()}).nullish()}).nullish(),
});
const pageState = z.object({
  noteData: z.object({data: z.object({noteData: noteSchema})}),
});

type FetchOptions = {signal: AbortSignal; fetch?: typeof fetch};
type NoteLink = Extract<NonNullable<ReturnType<typeof parseRedNoteUrl>>, {kind: 'note'}>;

export async function resolveRedNoteLink(
  input: string,
  {signal, fetch: fetcher = fetch}: FetchOptions,
): Promise<NoteLink> {
  let link = parseRedNoteUrl(input);

  for (let hop = 0; link?.kind === 'share' && hop < 4; hop++) {
    const response = await fetcher(link.url, {headers, signal, redirect: 'manual'});
    await response.body?.cancel();
    const location = response.headers.get('location');
    const target = location ? URL.parse(location, link.url) : null;

    link =
      response.status >= 300 && response.status < 400 && target
        ? parseRedNoteUrl(target)
        : null;
  }

  if (link?.kind !== 'note') {
    throw new Error(
      'RedNote share link did not resolve to a note. Copy a fresh link from the app.',
    );
  }

  return link;
}

export async function scrapeRedNotePost(
  {url, externalId}: NoteLink,
  {signal, fetch: fetcher = fetch}: FetchOptions,
): Promise<MediaPostSource> {
  const response = await fetcher(url, {headers, signal, redirect: 'manual'});

  if (!response.ok) {
    await response.body?.cancel();
    throw unavailableNote();
  }

  return parseRedNotePost(await response.text(), externalId);
}

function unavailableNote() {
  return new Error(
    'RedNote did not return the note. Try a fresh share link from the app.',
  );
}

export function parseRedNotePost(html: string, externalId: string): MediaPostSource {
  const $ = load(html);
  const state = $('script')
    .map(
      (_, script) =>
        $(script)
          .text()
          .match(/^\s*window\.__INITIAL_STATE__\s*=\s*([\s\S]+?)\s*;?\s*$/)?.[1],
    )
    .get()[0];

  if (!state) {
    throw unavailableNote();
  }

  const result = pageState.safeParse(parseState(state));
  const note = result.success ? result.data.noteData.data.noteData : undefined;

  if (note?.noteId.toLowerCase() !== externalId) {
    throw unavailableNote();
  }

  const gallery = (note.imageList ?? []).map(item => {
    const still =
      mediaUrl(item.url) ?? item.infoList?.map(info => mediaUrl(info.url)).find(Boolean);
    return {still, clip: item.livePhoto ? undefined : videoSource(item.stream)};
  });
  const video = videoSource(note.video?.media?.stream);
  const thumbnailUrl = mediaUrl(note.cover?.url) ?? gallery[0]?.still ?? null;

  // Video notes include the video poster in the image list.
  const entries = note.type === 'video' ? gallery.slice(1) : gallery;
  const media = entries.flatMap(({still, clip}): PostMediaSource[] =>
    clip ? [clip] : still ? [{kind: 'image', url: still}] : [],
  );

  if (video) {
    media.unshift(video);
  }

  if (!media.length) {
    throw new Error('RedNote note has no downloadable media.');
  }

  return {
    externalId,
    caption: [...new Set([note.title?.trim(), note.desc?.trim()].filter(Boolean))].join(
      '\n\n',
    ),
    username: note.user?.nickName?.trim() || null,
    postedAt: typeof note.time === 'number' ? new Date(note.time).toISOString() : null,
    thumbnailUrl,
    media,
  };
}

function parseState(state: string): unknown {
  try {
    // The state is JSON with bare undefined values in optional fields.
    return JSON.parse(
      state.replaceAll(/"(?:[^"\\]|\\.)*"|\bundefined\b/g, token =>
        token === 'undefined' ? 'null' : token,
      ),
    );
  } catch {
    return undefined;
  }
}

function videoSource(
  streams: z.infer<typeof stream> | null | undefined,
): PostMediaSource | undefined {
  const candidates = streams?.h264?.length
    ? streams.h264
    : Object.values(streams ?? {}).flat();
  const url = candidates
    .toSorted((a, b) => (b.width ?? 0) - (a.width ?? 0))
    .map(item => mediaUrl(item.masterUrl))
    .find(Boolean);
  return url ? {kind: 'video', url} : undefined;
}

function mediaUrl(input: string | null | undefined) {
  const url = input ? URL.parse(input) : null;
  if (
    !url ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !['rednotecdn.com', 'xhscdn.com'].some(domain => url.hostname.endsWith(`.${domain}`))
  ) {
    return null;
  }

  url.protocol = 'https:';
  url.hash = '';
  return url.href;
}

export const fetchRedNoteMedia: typeof fetch = (input, init) =>
  fetch(input, {...init, redirect: 'error'});
