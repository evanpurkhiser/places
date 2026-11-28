const noteHosts = new Set([
  'rednote.com',
  'www.rednote.com',
  'xiaohongshu.com',
  'www.xiaohongshu.com',
]);
const shareHosts = new Set(['xhslink.com', 'xhslink.cn']);
const notePath =
  /^\/(?:explore|discovery\/item|user\/profile\/[a-f0-9]{24})\/([a-f0-9]{24})\/?$/i;
const sharePath = /^\/(?:[A-Za-z]\/)?[A-Za-z0-9]+\/?$/;

export function canonicalNoteUrl(externalId: string) {
  return `https://www.rednote.com/discovery/item/${externalId}`;
}

export function parseRedNoteUrl(input: string | URL) {
  const url = URL.parse(input);

  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) {
    return null;
  }

  url.hash = '';

  const externalId = noteHosts.has(url.hostname)
    ? notePath.exec(url.pathname)?.[1]?.toLowerCase()
    : undefined;

  if (externalId) {
    const noteUrl = new URL(canonicalNoteUrl(externalId));
    const query = ['xsec_token', 'xsec_source'].flatMap(key => {
      const value = url.searchParams.get(key);
      return value ? [[key, value]] : [];
    });
    noteUrl.search = new URLSearchParams(query).toString();

    return {kind: 'note', externalId, url: noteUrl} as const;
  }

  if (shareHosts.has(url.hostname) && sharePath.test(url.pathname)) {
    url.search = '';
    return {kind: 'share', url} as const;
  }

  return null;
}

export type NoteLink = Extract<
  NonNullable<ReturnType<typeof parseRedNoteUrl>>,
  {kind: 'note'}
>;
