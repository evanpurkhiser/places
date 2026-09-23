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
    <Button
      className="place-tag"
      title={tag.description ?? undefined}
      aria-label={`Filter by ${tag.name}`}
      disabled={removing}
      onClick={event => {
        if (event.shiftKey && onRemove) {
          onRemove();
          return;
        }

        addTag(tag.name);
      }}
    >
      {tag.icon?.emoji && <span aria-hidden="true">{tag.icon.emoji}</span>}
      {tag.name}
      {onRemove && (
        <span className="tag-remove-indicator" aria-hidden="true">
          ×
        </span>
      )}
    </Button>
  );
}
