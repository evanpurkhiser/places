import {instagramSourceData} from '@places/common/contract/source';
import type {PgBoss} from 'pg-boss';

import {scrapeInstagramPost} from '../services/instagram/index.ts';
import type {CaptureResult} from '../services/media-import/index.ts';

import {importMediaPost, type MediaImportDependencies} from './import-media.ts';
import type {ImportRunIdentity} from './runs.ts';
import type {ImportOptions} from './types.ts';

const provider = {
  type: 'instagram' as const,
  name: 'Instagram',
  postDescription: 'an Instagram Reel or post',
  sourceData: ({caption, username, postedAt, thumbnailUrl}: CaptureResult['source']) =>
    instagramSourceData.parse({caption, username, postedAt, thumbnailUrl}),
};

export function importInstagramPost(
  jobs: PgBoss,
  dependencies: MediaImportDependencies,
  shortcode: string,
  options?: ImportOptions,
  run?: ImportRunIdentity,
) {
  const url = `https://www.instagram.com/p/${shortcode}/`;
  return importMediaPost(
    jobs,
    dependencies,
    provider,
    {externalId: shortcode, url, load: signal => scrapeInstagramPost(url, {signal})},
    options,
    run,
  );
}
