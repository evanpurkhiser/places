import {Button} from '@base-ui/react/button';

import type {Place} from './rpc.ts';
import {useSearch} from './SearchContext.tsx';

export function TagChip({tag}: {tag: Place['tags'][number]['tag']}) {
  const {addTag} = useSearch();

  return (
    <Button
      className="place-tag"
      title={tag.description ?? undefined}
      aria-label={`Filter by ${tag.name}`}
      onClick={() => addTag(tag.name)}
    >
      {tag.icon?.emoji && <span aria-hidden="true">{tag.icon.emoji}</span>}
      {tag.name}
    </Button>
  );
}
