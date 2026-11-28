import {useState} from 'react';

import {Popover} from '@base-ui/react/popover';
import {ArrowUpRight, Images, Instagram} from 'lucide-react';

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

function Thumbnail({url, provider}: {url: string; provider: string}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return null;
  }

  return (
    <img
      className="source-thumbnail"
      src={url}
      alt={`${provider} preview`}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}

export function PlaceSources({place}: {place: Place}) {
  const sources = place.sources ?? [];

  if (!sources.length) {
    return null;
  }

  const instagramOnly = sources.every(({source}) => source.type === 'instagram');
  const title = instagramOnly
    ? 'Instagram'
    : sources.every(({source}) => source.type === 'rednote')
      ? 'RedNote'
      : 'Sources';
  const Icon = instagramOnly ? Instagram : Images;

  return (
    <Popover.Root>
      <Popover.Trigger
        className="source-trigger"
        openOnHover
        delay={200}
        closeDelay={150}
        aria-label={`${title} for ${place.name}`}
      >
        <Icon size={14} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="source-positioner"
          side="right"
          align="start"
          sideOffset={6}
        >
          <Popover.Popup className="source-card">
            <Popover.Title className="source-card-title">{title}</Popover.Title>
            {sources.map(association => {
              const {source} = association;
              const provider = source.type === 'instagram' ? 'Instagram' : 'RedNote';
              const url =
                webUrl(source.url) ??
                (source.type === 'instagram' && source.externalId
                  ? `https://www.instagram.com/p/${encodeURIComponent(source.externalId)}/`
                  : undefined);
              const thumbnail = webUrl(source.data?.thumbnailUrl);

              return (
                <article className="source-entry" key={association.sourceId}>
                  {thumbnail && (
                    <Thumbnail key={thumbnail} url={thumbnail} provider={provider} />
                  )}
                  <div className="source-text">
                    {source.data?.username && (
                      <strong>
                        {source.type === 'instagram' ? '@' : ''}
                        {source.data.username}
                      </strong>
                    )}
                    <p>
                      {association.description ||
                        source.description ||
                        `Saved from ${provider}.`}
                    </p>
                    {url && (
                      <a href={url} target="_blank" rel="noreferrer">
                        Open on {provider} <ArrowUpRight size={12} />
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
