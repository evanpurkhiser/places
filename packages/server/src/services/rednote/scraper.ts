import {load} from 'cheerio';
import {z} from 'zod';

import type {MediaPostSource, PostMediaSource} from '../media-import/index.ts';

import {fetchRedNotePage, type FetchOptions} from './transport.ts';
import type {NoteLink} from './urls.ts';

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

export async function scrapeRedNotePost(link: NoteLink, options: FetchOptions) {
  const html = await fetchRedNotePage(link.url, options);

  if (html === null) {
    throw unavailableNote();
  }

  return parseRedNotePost(html, link.externalId);
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

  const captionLines = [
    ...new Set([note.title?.trim(), note.desc?.trim()].filter(Boolean)),
  ];

  return {
    externalId,
    caption: captionLines.join('\n\n'),
    username: note.user?.nickName?.trim() || null,
    postedAt: typeof note.time === 'number' ? new Date(note.time).toISOString() : null,
    thumbnailUrl,
    media,
  };
}

function parseState(state: string): unknown {
  try {
    // RedNote emits bare undefined values in the page state script.
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

  // Page state can list HTTP URLs for assets that the CDN serves over HTTPS.
  url.protocol = 'https:';
  url.hash = '';
  return url.href;
}
