import type {Place} from './rpc.ts';

export function placeEmoji(associations: Place['tags'] = []) {
  const tags = associations
    .map(association => association.tag)
    .filter(tag => tag.icon?.emoji)
    .toSorted((a, b) => a.name.localeCompare(b.name));

  return (tags.find(tag => tag.name.startsWith('type.')) ?? tags[0])?.icon?.emoji;
}
