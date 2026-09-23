import {MapPin} from 'lucide-react';

import {placeEmoji} from './place-icon.ts';
import type {Place} from './rpc.ts';

export function PlaceIcon({place, size = 18}: {place: Place; size?: number}) {
  const emoji = placeEmoji(place.tags);

  return emoji ? (
    <span className="place-emoji" style={{fontSize: size}} aria-hidden="true">
      {emoji}
    </span>
  ) : (
    <MapPin size={size} />
  );
}
