/**
 * Maps feature IDs encode two fixed64 fields inside a length-delimited protobuf.
 * This reverse-engineered layout applies to hex-pair IDs; Place Details validates
 * the resulting ID when the worker imports it.
 * https://github.com/liqfx/Google-Place-ID-Finder/blob/main/extract_place_id.py
 */
export function featureIdToPlaceId(featureId: string): string | null {
  const match = /^(0x[0-9a-f]{1,16}):(0x[0-9a-f]{1,16})$/i.exec(featureId);

  if (!match) {
    return null;
  }

  const bytes = Buffer.alloc(20);

  bytes.set([0x0a, 0x12, 0x09]);
  bytes.writeBigUInt64LE(BigInt(match[1]!), 3);
  bytes[11] = 0x11;
  bytes.writeBigUInt64LE(BigInt(match[2]!), 12);

  return bytes.toString('base64url');
}

export function placeIdFromData(data: string): string | null {
  let decoded: string;

  try {
    decoded = decodeURIComponent(data);
  } catch {
    return null;
  }

  const tokens = decoded.split('!');
  const explicit = tokens.filter(token => token.startsWith('19s'));
  const features = tokens.filter(token => token.startsWith('1s'));
  const ids = explicit.length
    ? explicit.map(token =>
        /^19s[A-Za-z0-9_-]{1,255}$/.test(token) ? token.slice(3) : null,
      )
    : features.map(token => featureIdToPlaceId(token.slice(2)));

  if (!ids.length || ids.some(id => id === null) || new Set(ids).size !== 1) {
    return null;
  }

  return ids[0]!;
}
