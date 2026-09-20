import {importResult} from '@places/common/contract/place';

import {importPayload, importQueue} from '../jobs/gmaps-import.ts';
import {isGoogleMapsInput} from '../services/google/index.ts';

import {type Importer, pendingStatus} from './types.ts';

export const googleImporter: Importer = {
  type: 'gmaps',
  queue: importQueue,
  accepts: isGoogleMapsInput,
  async enqueue(input, options, {google, jobs}) {
    const payload = {
      ...importPayload.parse({googlePlaceId: await google.resolve(input)}),
      ...options,
    };
    return jobs.send(importQueue, payload);
  },
  getStatus(job) {
    return {
      ...pendingStatus(job),
      placeIds: job.state === 'completed' ? importResult.parse(job.output).placeIds : [],
    };
  },
};
