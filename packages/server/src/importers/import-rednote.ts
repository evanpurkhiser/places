import {rednoteSourceData} from '@places/common/contract/source';
import type {PgBoss} from 'pg-boss';

import type {CaptureResult} from '../services/media-import/index.ts';
import {parseRedNotePost} from '../services/rednote/scraper.ts';
import {fetchRedNoteMedia, fetchRedNotePage} from '../services/rednote/transport.ts';
import {
  canonicalNoteUrl,
  parseRedNoteUrl,
  type RedNoteLink,
} from '../services/rednote/urls.ts';

import {InvalidImportInputError} from './errors.ts';
import {importMediaPost, type MediaImportDependencies} from './import-media.ts';
import type {ImportRunIdentity} from './runs.ts';
import type {ImportOptions} from './types.ts';

const provider = {
  type: 'rednote' as const,
  name: 'RedNote',
  postDescription: 'a RedNote note',
  sourceData: ({caption, username, postedAt, thumbnailUrl}: CaptureResult['source']) =>
    rednoteSourceData.parse({caption, username, postedAt, thumbnailUrl}),
};

export async function importRedNotePost(
  jobs: PgBoss,
  dependencies: MediaImportDependencies,
  input: string,
  options: ImportOptions,
  run: ImportRunIdentity,
) {
  const link = parseRedNoteUrl(input);

  if (!link) {
    throw new InvalidImportInputError('Expected a RedNote URL.');
  }

  const source =
    link.kind === 'note'
      ? {
          externalId: link.externalId,
          async load(signal: AbortSignal) {
            const {html} = await fetchRedNotePage(link, {signal});
            return parseRedNotePost(html, link.externalId);
          },
        }
      : await fetchSharedPost(link, dependencies.config.capture.timeoutMs);

  return importMediaPost(
    jobs,
    dependencies,
    provider,
    {
      ...source,
      url: canonicalNoteUrl(source.externalId),
      fetchMedia: fetchRedNoteMedia,
    },
    options,
    run,
  );
}

async function fetchSharedPost(link: RedNoteLink, timeoutMs: number) {
  const {externalId, html} = await fetchRedNotePage(link, {
    signal: AbortSignal.timeout(timeoutMs),
  });

  return {
    externalId,
    load: () => Promise.resolve(parseRedNotePost(html, externalId)),
  };
}
