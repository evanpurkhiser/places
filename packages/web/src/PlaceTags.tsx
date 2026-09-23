import {useMutation, useQueryClient} from '@tanstack/react-query';

import {rpc, type Place} from './rpc.ts';
import {TagList} from './TagList.tsx';
import type {Tag} from './TagPicker.tsx';

export function PlaceTags({
  place,
  onUpdate,
}: {
  place: Place;
  onUpdate?: (place: Place) => void;
}) {
  const queryClient = useQueryClient();
  const addMutation = useMutation(rpc.places.tag.mutationOptions());
  const removeMutation = useMutation(rpc.places.untag.mutationOptions());

  function updatePlace(update: (current: Place) => Place) {
    queryClient.setQueriesData<Place[]>({queryKey: rpc.places.list.key()}, current =>
      current?.map(item => (item.id === place.id ? update(item) : item)),
    );
    onUpdate?.(update(place));
  }

  async function addTag(tag: Tag) {
    removeMutation.reset();

    try {
      const association = await addMutation.mutateAsync({
        placeId: place.id,
        tag: tag.name,
      });

      updatePlace(current => ({
        ...current,
        tags: [
          ...current.tags.filter(item => item.tagId !== tag.id),
          {...association, tag},
        ],
      }));
      await queryClient.invalidateQueries({queryKey: rpc.places.list.key()});
    } catch {
      // The mutation retains the error for the inline retry message.
    }
  }

  async function removeTag(tag: Tag) {
    addMutation.reset();

    try {
      await removeMutation.mutateAsync({placeId: place.id, tag: tag.id});
      updatePlace(current => ({
        ...current,
        tags: current.tags.filter(item => item.tagId !== tag.id),
      }));
      await queryClient.invalidateQueries({queryKey: rpc.places.list.key()});
    } catch {
      // The mutation retains the error for the inline retry message.
    }
  }

  const isPending = addMutation.isPending || removeMutation.isPending;
  const hasError = addMutation.isError || removeMutation.isError;

  return (
    <>
      <TagList
        tags={place.tags.map(({tag}) => tag)}
        onAdd={tag => void addTag(tag)}
        onRemove={tag => void removeTag(tag)}
        disabled={isPending}
      />
      {hasError && (
        <span className="tag-save-error" role="alert">
          Could not update tags. Try again.
        </span>
      )}
    </>
  );
}
