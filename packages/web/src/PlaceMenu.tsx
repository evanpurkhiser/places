import {useState} from 'react';

import {Menu} from '@base-ui/react/menu';
import {useMutation, useQueryClient} from '@tanstack/react-query';
import {Ellipsis, Trash2} from 'lucide-react';

import {rpc, type Place} from './rpc.ts';

export function PlaceMenu({place, onRemoved}: {place: Place; onRemoved?: () => void}) {
  const queryClient = useQueryClient();
  const mutation = useMutation(rpc.places.delete.mutationOptions());
  const [open, setOpen] = useState(false);

  async function removePlace() {
    if (!window.confirm(`Remove ${place.name} from your saved places?`)) {
      return;
    }

    try {
      await mutation.mutateAsync({id: place.id});
      queryClient.setQueriesData<Place[]>({queryKey: rpc.places.list.key()}, current =>
        current?.filter(item => item.id !== place.id),
      );
      onRemoved?.();
      await queryClient.invalidateQueries({queryKey: rpc.places.list.key()});
    } catch {
      setOpen(true);
    }
  }

  return (
    <Menu.Root open={open} onOpenChange={setOpen}>
      <Menu.Trigger
        className="place-menu-trigger"
        aria-label={`Actions for ${place.name}`}
        title="More actions"
        disabled={mutation.isPending}
      >
        <Ellipsis size={16} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          className="place-menu-positioner"
          side="bottom"
          align="end"
          sideOffset={4}
        >
          <Menu.Popup className="place-menu-popup">
            <Menu.Item
              className="place-menu-item danger"
              onClick={() => void removePlace()}
            >
              <Trash2 size={14} />
              {mutation.isError ? 'Could not remove. Try again' : 'Remove place'}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
