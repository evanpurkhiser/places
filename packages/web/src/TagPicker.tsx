import {useState} from 'react';

import {Button} from '@base-ui/react/button';
import {Combobox} from '@base-ui/react/combobox';
import {useQuery} from '@tanstack/react-query';
import {Plus, Tag as TagIcon} from 'lucide-react';

import {rpc, type Place} from './rpc.ts';

export type Tag = Place['tags'][number]['tag'];

interface Props {
  excludedIds: string[];
  onSelect: (tag: Tag) => void;
  disabled?: boolean;
}

export function TagPicker({excludedIds, onSelect, disabled}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const tags = useQuery(rpc.tags.list.queryOptions());
  const items = (tags.data ?? [])
    .filter(tag => !tag.archived && !excludedIds.includes(tag.id))
    .toSorted((a, b) => a.name.localeCompare(b.name));

  return (
    <Combobox.Root
      items={items}
      value={null}
      open={open}
      onOpenChange={value => {
        setOpen(value);
        setSearch('');
      }}
      inputValue={search}
      onInputValueChange={setSearch}
      itemToStringLabel={(tag: Tag) => tag.name}
      filter={(tag, query) =>
        `${tag.name} ${tag.description ?? ''}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())
      }
      onValueChange={tag => {
        if (!tag) {
          return;
        }

        onSelect(tag);
        setOpen(false);
      }}
    >
      <Combobox.Trigger
        className="place-tag tag-picker-trigger"
        aria-label="Add tag"
        disabled={disabled}
      >
        <Plus size={12} />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          className="tag-picker-positioner"
          sideOffset={4}
          align="start"
        >
          <Combobox.Popup className="tag-picker-popup">
            <Combobox.Input
              className="tag-picker-search"
              aria-label="Search tags"
              placeholder="Search tags…"
            />
            {tags.isPending && (
              <div className="tag-picker-status" role="status">
                Loading tags…
              </div>
            )}
            {tags.isError && (
              <div className="tag-picker-status" role="alert">
                Could not load tags.{' '}
                <Button onClick={() => void tags.refetch()}>Retry</Button>
              </div>
            )}
            {tags.isSuccess && (
              <Combobox.Empty className="tag-picker-status">
                No matching tags.
              </Combobox.Empty>
            )}
            <Combobox.List className="tag-picker-list">
              {(tag: Tag) => (
                <Combobox.Item key={tag.id} value={tag} className="tag-picker-item">
                  <span className="tag-picker-icon" aria-hidden="true">
                    {tag.icon?.emoji ?? <TagIcon size={16} />}
                  </span>
                  <span className="tag-picker-label">{tag.name}</span>
                  {tag.description && (
                    <span className="tag-picker-description">{tag.description}</span>
                  )}
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
