import {parseRedNoteUrl, type NoteLink} from './urls.ts';

const headers = {
  'user-agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
};
export type FetchOptions = {signal: AbortSignal; fetch?: typeof fetch};

async function resolveShareLink(
  initialUrl: URL,
  {signal, fetch: fetcher = fetch}: FetchOptions,
): Promise<NoteLink | null> {
  let url = initialUrl;

  for (let hop = 0; hop < 4; hop++) {
    const response = await fetcher(url, {headers, signal, redirect: 'manual'});
    await response.body?.cancel();
    const location = response.headers.get('location');

    if (response.status < 300 || response.status >= 400 || !location) {
      return null;
    }

    const target = URL.parse(location, url);
    const link = target && parseRedNoteUrl(target);

    if (link?.kind !== 'share') {
      return link;
    }

    url = link.url;
  }

  return null;
}

export async function resolveRedNoteLink(
  input: string,
  options: FetchOptions,
): Promise<NoteLink> {
  const link = parseRedNoteUrl(input);
  const note = link?.kind === 'share' ? await resolveShareLink(link.url, options) : link;

  if (!note) {
    throw new Error(
      'RedNote share link did not resolve to a note. Copy a fresh link from the app.',
    );
  }

  return note;
}

export async function fetchRedNotePage(
  url: URL,
  {signal, fetch: fetcher = fetch}: FetchOptions,
) {
  const response = await fetcher(url, {headers, signal, redirect: 'manual'});

  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }

  return response.text();
}

export const fetchRedNoteMedia: typeof fetch = (input, init) =>
  fetch(input, {...init, redirect: 'error'});
