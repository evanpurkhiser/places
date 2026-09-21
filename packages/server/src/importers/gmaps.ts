import {importResult} from '@places/common/contract/place';

import {enqueuePlaceImport, importQueue} from '../jobs/gmaps-import.ts';
import {isGoogleMapsInput} from '../services/google/index.ts';

import {type Importer, pendingStatus} from './types.ts';

export const googleImporter: Importer = {
  type: 'gmaps',
  queue: importQueue,
  accepts: isGoogleMapsInput,
  async enqueue(input, options, {google, jobs}) {
    return enqueuePlaceImport(jobs, {
      googlePlaceId: await google.resolve(input),
      ...options,
    });
  },
  getStatus(job) {
    return {
      ...pendingStatus(job),
      placeIds: job.state === 'completed' ? importResult.parse(job.output).placeIds : [],
    };
  },
};
