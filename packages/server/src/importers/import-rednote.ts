import {rednoteSourceData} from '@places/common/contract/source';
import type {PgBoss} from 'pg-boss';

import type {CaptureResult} from '../services/media-import/index.ts';
import {
  fetchRedNoteMedia,
  resolveRedNoteLink,
  scrapeRedNotePost,
} from '../services/rednote/scraper.ts';
import {canonicalNoteUrl} from '../services/rednote/urls.ts';

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
  const resolvingSignal = AbortSignal.timeout(
    Math.min(dependencies.config.capture.timeoutMs, 15000),
  );
  const note = await resolveRedNoteLink(input, {signal: resolvingSignal});

  return importMediaPost(
    jobs,
    dependencies,
    provider,
    {
      externalId: note.externalId,
      url: canonicalNoteUrl(note.externalId),
      load: signal => scrapeRedNotePost(note, {signal}),
      fetchMedia: fetchRedNoteMedia,
    },
    options,
    run,
  );
}
