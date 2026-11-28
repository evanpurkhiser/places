import {expect, it, vi} from 'vitest';

import {resolveRedNoteLink} from './transport.ts';
import {canonicalNoteUrl} from './urls.ts';

const externalId = '6a22d82d000000001002d001';
const signal = new AbortController().signal;
const start = 'https://xhslink.com/o/AbCdEf';

function redirect(location: string) {
  return new Response(null, {status: 302, headers: {location}});
}

it('follows share redirects up to the note link and retains its retrieval params', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(redirect('/o/Next'))
    .mockResolvedValueOnce(
      redirect(
        `https://www.xiaohongshu.com/discovery/item/${externalId}?xsec_token=share&xsec_source=app&share_id=tracking`,
      ),
    );

  const note = await resolveRedNoteLink(start, {fetch, signal});

  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    start,
    'https://xhslink.com/o/Next',
  ]);
  expect(note.externalId).toBe(externalId);
  expect(note.url.href).toBe(
    `${canonicalNoteUrl(externalId)}?xsec_token=share&xsec_source=app`,
  );
});

it('stops before requesting a redirect outside the supported hosts', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(redirect('https://other.example/note'));

  await expect(resolveRedNoteLink(start, {fetch, signal})).rejects.toThrow(
    'did not resolve to a note',
  );
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    new URL(start),
    expect.objectContaining({redirect: 'manual', signal}),
  );
});
