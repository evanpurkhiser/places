import {expect, it, vi} from 'vitest';

import {fetchRedNotePage} from './transport.ts';
import {canonicalNoteUrl, parseRedNoteUrl} from './urls.ts';

const externalId = '6a22d82d000000001002d001';
const signal = new AbortController().signal;
const start = 'https://xhslink.com/o/AbCdEf';
const shareLink = parseRedNoteUrl(start)!;

function redirect(location: string) {
  return new Response(null, {status: 302, headers: {location}});
}

it('follows share redirects and reads the note page with its retrieval params', async () => {
  const html = '<title>Taipei cafes</title>';
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(redirect('/o/Next'))
    .mockResolvedValueOnce(
      redirect(
        `https://www.xiaohongshu.com/discovery/item/${externalId}?xsec_token=share&xsec_source=app&share_id=tracking`,
      ),
    )
    .mockResolvedValueOnce(new Response(html));

  await expect(fetchRedNotePage(shareLink, {fetch, signal})).resolves.toEqual({
    externalId,
    html,
  });
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    start,
    'https://xhslink.com/o/Next',
    `${canonicalNoteUrl(externalId)}?xsec_token=share&xsec_source=app`,
  ]);
});

it('stops before requesting a redirect outside the supported hosts', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(redirect('https://other.example/note'));

  await expect(fetchRedNotePage(shareLink, {fetch, signal})).rejects.toThrow(
    'did not return the note',
  );
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    new URL(start),
    expect.objectContaining({redirect: 'manual', signal}),
  );
});
