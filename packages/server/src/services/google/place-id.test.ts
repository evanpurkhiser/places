import {describe, expect, it} from 'vitest';

import {featureIdToPlaceId, placeIdFromData} from './place-id.ts';

describe('Maps feature IDs', () => {
  it.each([
    ['0x89c2590050d251e3:0xd0a2838a932ab585', 'ChIJ41HSUABZwokRhbUqk4qDotA'],
    ['0x89c2597736224cf1:0x6c0d7aa1be5e1575', 'ChIJ8UwiNndZwokRdRVevqF6DWw'],
    ['0x89c259002c02e8d7:0x86c58b9d1a45005b', 'ChIJ1-gCLABZwokRWwBFGp2LxYY'],
  ])('converts %s without losing integer precision', (feature, id) => {
    expect(featureIdToPlaceId(feature)).toBe(id);
    expect(placeIdFromData(`!4m2!3m1!1s${feature}`)).toBe(id);
  });

  it('preserves the full unsigned 64-bit range', () => {
    const id = featureIdToPlaceId('0xffffffffffffffff:0x0')!;
    const bytes = Buffer.from(id, 'base64url');

    expect(bytes.readBigUInt64LE(3)).toBe(0xffffffffffffffffn);
    expect(bytes.readBigUInt64LE(12)).toBe(0n);
  });

  it.each([
    '',
    '0x1',
    '0x1:0x',
    '-0x1:0x2',
    '0x10000000000000000:0x2',
    '0x1:0x10000000000000000',
    '0x1:0x2junk',
  ])('rejects malformed or overflowing feature IDs: %s', input => {
    expect(featureIdToPlaceId(input)).toBeNull();
  });

  it.each([
    '',
    '!3d40!4d-73',
    '!1s0x1:0x2junk',
    '!1s0x1:0x2!1s0x3:0x4',
    '!19sOne!19sTwo',
    '!1s%ZZ',
    '!19sbad/id',
  ])('rejects missing, malformed, or ambiguous data: %s', data => {
    expect(placeIdFromData(data)).toBeNull();
  });
});
