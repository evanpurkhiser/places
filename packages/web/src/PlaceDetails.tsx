import {Button} from '@base-ui/react/button';
import {ArrowLeft, ArrowUpRight, MapPin} from 'lucide-react';

import {googleMapsUrl} from './google-maps.ts';
import {PlaceIcon} from './PlaceIcon.tsx';
import {PlaceSources} from './PlaceSources.tsx';
import {PlaceTags} from './PlaceTags.tsx';
import type {Place} from './rpc.ts';

export function PlaceDetails({
  place,
  onClose,
  onUpdate,
}: {
  place: Place;
  onClose: () => void;
  onUpdate: (place: Place) => void;
}) {
  return (
    <>
      <div className="detail-top">
        <Button className="text-button" onClick={onClose}>
          <ArrowLeft size={16} />
          Places
        </Button>
        <span className="eyebrow">SAVED PLACE</span>
      </div>
      <div className="detail-heading">
        <span className="large-category">
          <PlaceIcon place={place} size={22} />
        </span>
        <h1>
          {place.name} <PlaceSources place={place} />
        </h1>
        <p>
          <MapPin size={14} />
          {place.formattedAddress}
        </p>
      </div>
      <div className="detail-content">
        <section>
          <div className="section-label">TAGS</div>
          <PlaceTags key={place.id} place={place} onUpdate={onUpdate} />
        </section>
        <section>
          <div className="section-label">NOTE</div>
          <p className="place-note">{place.userNote || 'No note saved yet.'}</p>
        </section>
        <section>
          <div className="section-label">SAVED</div>
          <p>
            {place.createdAt.toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </section>
        <a
          className="external-link"
          href={googleMapsUrl(place)}
          target="_blank"
          rel="noreferrer"
        >
          Open in Google Maps
          <ArrowUpRight size={17} />
        </a>
      </div>
    </>
  );
}
