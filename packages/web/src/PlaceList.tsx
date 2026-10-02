import {useCallback, useRef, type ReactNode} from 'react';

import {Button} from '@base-ui/react/button';
import {useVirtualizer} from '@tanstack/react-virtual';
import {LocateFixed} from 'lucide-react';

import {PlaceIcon} from './PlaceIcon.tsx';
import {PlaceSources} from './PlaceSources.tsx';
import {PlaceTags} from './PlaceTags.tsx';
import type {Place} from './rpc.ts';

export function PlaceList({
  places,
  pending,
  onSelect,
  onLocate,
  children,
}: {
  places: Place[];
  pending: boolean;
  onSelect: (place: Place) => void;
  onLocate: (place: Place) => void;
  children: ReactNode;
}) {
  const scrollElement = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((index: number) => places[index]!.id, [places]);
  const virtualizer = useVirtualizer({
    count: places.length,
    getScrollElement: () => scrollElement.current,
    getItemKey,
    estimateSize: () => 100,
    overscan: 5,
  });

  return (
    <div className="place-list" ref={scrollElement} aria-busy={pending}>
      <div
        role="list"
        aria-label="Saved places"
        style={{height: virtualizer.getTotalSize(), position: 'relative', width: '100%'}}
      >
        {virtualizer.getVirtualItems().map(item => {
          const place = places[item.index]!;

          return (
            <div
              className="place-row"
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              role="listitem"
              aria-posinset={item.index + 1}
              aria-setsize={places.length}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateY(${item.start}px)`,
              }}
            >
              <span className="place-category">
                <PlaceIcon place={place} size={18} />
              </span>
              <span className="place-text">
                <Button className="place-open" onClick={() => onSelect(place)}>
                  <strong>{place.name}</strong>
                  <span>{place.formattedAddress}</span>
                </Button>
                <PlaceTags place={place} />
              </span>
              <PlaceSources place={place} />
              <Button
                className="place-locate"
                title="Show on map"
                aria-label={`Show ${place.name} on map`}
                onClick={() => onLocate(place)}
              >
                <LocateFixed size={14} />
              </Button>
            </div>
          );
        })}
      </div>
      {children}
    </div>
  );
}
