import {enqueueRedNoteImport} from '../jobs/rednote-import.ts';
import {parseRedNoteUrl} from '../services/rednote/urls.ts';

import {ImportUnavailableError} from './errors.ts';
import {getMediaImportStatus} from './media-status.ts';
import type {Importer} from './types.ts';

export const rednoteImporter: Importer = {
  type: 'rednote',
  accepts: input => parseRedNoteUrl(input) !== null,
  enqueue(input, options, {jobs, db, userId, config}) {
    if (!config.rednote) {
      throw new ImportUnavailableError('Configure rednote to import RedNote notes.');
    }

    return enqueueRedNoteImport(jobs, db, input, options, userId);
  },
  getStatus: getMediaImportStatus,
};
