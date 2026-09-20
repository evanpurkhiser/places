import {expect, it} from 'vitest';

import {importPayload} from './gmaps-import.ts';

it('accepts JSON recommendation data associated with an existing source', () => {
  const source = {
    sourceId: '00000000-0000-4000-8000-000000000001',
    description: 'A neighborhood cafe',
    data: {evidence: 'Caption', frames: [2, 5], details: {confirmed: true}},
  };
  expect(importPayload.parse({googlePlaceId: 'test', source})).toEqual({
    googlePlaceId: 'test',
    tags: [],
    source,
  });
});

it.each([
  {sourceId: 'invalid'},
  {sourceId: '00000000-0000-4000-8000-000000000001', data: []},
  {sourceId: '00000000-0000-4000-8000-000000000001', data: {value: undefined}},
])('rejects invalid source association input: %j', source => {
  expect(importPayload.safeParse({googlePlaceId: 'test', source}).success).toBe(false);
});
