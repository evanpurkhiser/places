import {TagChip} from './TagChip.tsx';
import {TagPicker, type Tag} from './TagPicker.tsx';

interface Props {
  tags: Tag[];
  onAdd: (tag: Tag) => void;
  disabled?: boolean;
}

export function TagList({tags, onAdd, disabled}: Props) {
  return (
    <span className="place-tags">
      {tags
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map(tag => (
          <TagChip key={tag.id} tag={tag} />
        ))}
      <TagPicker
        excludedIds={tags.map(tag => tag.id)}
        onSelect={onAdd}
        disabled={disabled}
      />
    </span>
  );
}
