import {enqueueInstagramImport} from '../jobs/instagram-import.ts';
import {instagramShortcode} from '../services/instagram/index.ts';

import {getMediaImportStatus} from './media-status.ts';
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
  getStatus: getMediaImportStatus,
};
