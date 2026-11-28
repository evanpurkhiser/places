import {parseRedNoteUrl, type RedNoteLink} from './urls.ts';

const headers = {
  'user-agent':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
};
type FetchOptions = {signal: AbortSignal; fetch?: typeof fetch};

export async function fetchRedNotePage(
  initialLink: RedNoteLink,
  {signal, fetch: fetcher = fetch}: FetchOptions,
) {
  let link: RedNoteLink | null = initialLink;

  for (let redirects = 0; link && redirects <= 4; redirects++) {
    const response: Response = await fetcher(link.url, {
      headers,
      signal,
      redirect: 'manual',
    });

    if (response.ok && link.kind === 'note') {
      return {externalId: link.externalId, html: await response.text()};
    }

    await response.body?.cancel();
    const location = response.headers.get('location');
    const target: URL | null =
      response.status >= 300 && response.status < 400 && location
        ? URL.parse(location, link.url)
        : null;
    link = target && parseRedNoteUrl(target);
  }

  throw new Error(
    'RedNote did not return the note. Try a fresh share link from the app.',
  );
}

export const fetchRedNoteMedia: typeof fetch = (input, init) =>
  fetch(input, {...init, redirect: 'error'});
