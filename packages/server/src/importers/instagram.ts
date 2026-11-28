import {enqueueInstagramImport} from '../jobs/instagram-import.ts';
import {instagramShortcode} from '../services/instagram/index.ts';

import {getMediaImportStatuses} from './media-status.ts';
import type {Importer} from './types.ts';

export const instagramImporter: Importer = {
  type: 'instagram',
  accepts(input) {
    try {
      instagramShortcode(input);
      return true;
    } catch {
      return false;
    }
  },
  enqueue: (input, options, {jobs, db, userId}) =>
    enqueueInstagramImport(jobs, db, input, options, userId),
  async getStatus(run, context) {
    const statuses = await getMediaImportStatuses([run], context);

    return statuses.get(run.id)!;
  },
};
