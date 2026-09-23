import {useState} from 'react';

import {Popover} from '@base-ui/react/popover';
import {ArrowUpRight, Instagram} from 'lucide-react';

import type {Place} from './rpc.ts';

function webUrl(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function Thumbnail({url}: {url: string}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <img
      className="source-thumbnail"
      src={url}
      alt="Instagram preview"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function PlaceSources({place}: {place: Place}) {
  const sources = (place.sources ?? []).filter(({source}) => source.type === 'instagram');

  if (!sources.length) {
    return null;
  }

  return (
    <Popover.Root>
      <Popover.Trigger
        className="source-trigger"
        openOnHover
        delay={200}
        closeDelay={150}
        aria-label={`Instagram sources for ${place.name}`}
      >
        <Instagram size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="source-positioner"
          side="right"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup className="source-card">
            <Popover.Title className="source-card-title">Instagram</Popover.Title>
            {sources.map(association => {
              const {source} = association;
              const url =
                webUrl(source.url) ??
                (source.externalId
                  ? `https://www.instagram.com/p/${encodeURIComponent(source.externalId)}/`
                  : undefined);
              const thumbnail = webUrl(source.data?.thumbnailUrl);

              return (
                <article className="source-entry" key={association.sourceId}>
                  {thumbnail && <Thumbnail key={thumbnail} url={thumbnail} />}
                  <div className="source-text">
                    {source.data?.username && <strong>@{source.data.username}</strong>}
                    <p>
                      {association.description ||
                        source.description ||
                        'Saved from Instagram.'}
                    </p>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer">
                        Open on Instagram <ArrowUpRight size={12} />
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
