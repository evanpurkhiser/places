import {describe, expect, it} from 'vitest';

import {canonicalNoteUrl, parseRedNoteUrl} from './urls.ts';

const externalId = '6a22d82d000000001002d001';

describe('RedNote URLs', () => {
  it.each([
    canonicalNoteUrl(externalId),
    `https://rednote.com/explore/${externalId}`,
    `https://www.xiaohongshu.com/explore/${externalId}`,
  ])('normalizes the note link %s', input => {
    expect(parseRedNoteUrl(input)).toEqual({
      kind: 'note',
      externalId,
      url: new URL(canonicalNoteUrl(externalId)),
    });
  });

  it.each([`http://rednote.com/explore/${externalId}`, 'http://xhslink.com/o/AbCdEf'])(
    'requires HTTPS for input links such as %s',
    input => {
      expect(parseRedNoteUrl(input)).toBeNull();
    },
  );
});
