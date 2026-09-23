import {Button} from '@base-ui/react/button';

import type {Place} from './rpc.ts';
import {useSearch} from './SearchContext.tsx';

export function TagChip({
  tag,
  removing,
  onRemove,
}: {
  tag: Place['tags'][number]['tag'];
  removing?: boolean;
  onRemove?: () => void;
}) {
  const {addTag} = useSearch();

  return (
    <span className="place-tag-wrap">
      <Button
        className="place-tag"
        title={tag.description ?? undefined}
        aria-label={`Filter by ${tag.name}`}
        disabled={removing}
        onClick={() => addTag(tag.name)}
      >
        {tag.icon?.emoji && <span aria-hidden="true">{tag.icon.emoji}</span>}
        {tag.name}
      </Button>
      {onRemove && (
        <Button
          className="tag-remove"
          aria-label={`Remove ${tag.name}`}
          title={`Remove ${tag.name}`}
          disabled={removing}
          onClick={onRemove}
        >
          ×
        </Button>
      )}
    </span>
  );
}
