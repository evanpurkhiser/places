import {describe, expect, it} from 'vitest';

import {source} from './source.ts';

const instagram = {
  id: '00000000-0000-4000-8000-000000000001',
  type: 'instagram',
  externalId: 'Dcw6FFrISub',
  url: 'https://www.instagram.com/p/Dcw6FFrISub/',
  description: 'A French-Thai cafe recommendation in Queens.',
  data: {
    caption: 'Thai French FUSION café',
    username: 'vivecachow',
    postedAt: '2026-09-01T12:00:00.000Z',
    thumbnailUrl: 'https://cdn.example/cover.jpg',
  },
  createdAt: new Date('2026-09-20T00:00:00Z'),
  updatedAt: new Date('2026-09-20T00:00:00Z'),
};

describe('source contract', () => {
  it('validates Instagram metadata under its source type', () => {
    expect(source.parse(instagram)).toEqual(instagram);
  });

  it('allows unavailable external identity and display metadata', () => {
    const value = {
      ...instagram,
      externalId: null,
      data: {caption: '', username: null, postedAt: null, thumbnailUrl: null},
    };
    expect(source.parse(value)).toEqual(value);
  });

  it('rejects an unsupported source type', () => {
    expect(source.safeParse({...instagram, type: 'unknown'}).success).toBe(false);
  });

  it('rejects empty external IDs', () => {
    expect(source.safeParse({...instagram, externalId: ''}).success).toBe(false);
  });

  it.each([
    {caption: 123},
    {username: ''},
    {postedAt: 'yesterday'},
    {postedAt: 1788264000},
    {thumbnailUrl: 'cover.jpg'},
    {unrecognized: 'field'},
  ])('rejects malformed Instagram data: %j', change => {
    expect(
      source.safeParse({...instagram, data: {...instagram.data, ...change}}).success,
    ).toBe(false);
  });

  it('requires Instagram metadata fields', () => {
    expect(source.safeParse({...instagram, data: {caption: 'A cafe'}}).success).toBe(
      false,
    );
  });
});
