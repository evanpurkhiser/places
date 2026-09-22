import type {StringValue} from '@places/common/search';
import {expect, it, vi} from 'vitest';

import type {Context} from '../context.ts';

import {tagNameResolver} from './tag-name.ts';

function tag(value: string, wildcards: number[] = []): StringValue {
  const position = {offset: 0, line: 1, column: 1};
  return {
    type: 'string',
    value,
    quoted: false,
    wildcards,
    text: value,
    location: {start: position, end: position},
  };
}

function context(tagExists: Context['tagExists']): Context {
  return {
    now: Date.now(),
    tagExists,
    resolvePoint: vi.fn(),
  };
}

it('normalizes and validates exact tag names', async () => {
  const tagExists = vi.fn(() => Promise.resolve(true));
  const value = tag(' Type.Cafe ');

  await expect(tagNameResolver.resolve(value, context(tagExists), null)).resolves.toBe(
    value,
  );
  expect(tagExists).toHaveBeenCalledExactlyOnceWith('type.cafe');
});

it('permits patterns without requiring an existing tag', async () => {
  const tagExists = vi.fn(() => Promise.resolve(false));
  const value = tag('type.*', [5]);

  await expect(tagNameResolver.resolve(value, context(tagExists), null)).resolves.toBe(
    value,
  );
  expect(tagExists).not.toHaveBeenCalled();
});

it('rejects an unknown exact tag', async () => {
  const value = tag('missing');

  await expect(
    tagNameResolver.resolve(
      value,
      context(() => Promise.resolve(false)),
      null,
    ),
  ).rejects.toThrow('Unknown tag: missing');
});
