import {describe, expect, it} from 'vitest';

import {placeEmoji} from './place-icon.ts';
import type {Place} from './rpc.ts';

function association(name: string, emoji: string | null): Place['tags'][number] {
  const createdAt = new Date('2026-09-18');

  return {
    placeId: 'place',
    tagId: name,
    note: null,
    createdAt,
    tag: {
      namespaceId: null,
      archived: false,
      id: name,
      name,
      icon: emoji ? {emoji} : null,
      description: null,
      createdAt,
      updatedAt: createdAt,
    },
  };
}

describe('place marker emoji', () => {
  it('prefers a type icon over other tag icons', () => {
    expect(
      placeEmoji([association('rating.favorite', '⭐'), association('type.cafe', '☕')]),
    ).toBe('☕');
  });

  it('chooses a stable icon regardless of association order', () => {
    const tags = [association('type.restaurant', '🍽️'), association('type.cafe', '☕')];
    expect(placeEmoji(tags)).toBe('☕');
    expect(placeEmoji(tags.toReversed())).toBe('☕');
  });

  it('falls back to another tag with an icon', () => {
    expect(
      placeEmoji([association('type.cafe', null), association('rating.favorite', '⭐')]),
    ).toBe('⭐');
  });

  it('leaves untagged places and tags without icons to the generic pin', () => {
    expect(placeEmoji([])).toBeUndefined();
    expect(placeEmoji([association('type.cafe', null)])).toBeUndefined();
    expect(placeEmoji()).toBeUndefined();
  });
});
