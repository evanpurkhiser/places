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
  const mutation = useMutation(rpc.places.tag.mutationOptions());

  async function addTag(tag: Tag) {
    try {
      const association = await mutation.mutateAsync({placeId: place.id, tag: tag.name});
      const update = (current: Place): Place => ({
        ...current,
        tags: [
          ...current.tags.filter(item => item.tagId !== tag.id),
          {...association, tag},
        ],
      });

      queryClient.setQueriesData<Place[]>({queryKey: rpc.places.list.key()}, current =>
        current?.map(item => (item.id === place.id ? update(item) : item)),
      );
      onUpdate?.(update(place));
      await queryClient.invalidateQueries({queryKey: rpc.places.list.key()});
    } catch {
      // The mutation retains the error for the inline retry message.
    }
  }

  return (
    <>
      <TagList
        tags={place.tags.map(({tag}) => tag)}
        onAdd={tag => void addTag(tag)}
        disabled={mutation.isPending}
      />
      {mutation.isError && (
        <span className="tag-save-error" role="alert">
          Could not add tag. Use + to try again.
        </span>
      )}
    </>
  );
}
