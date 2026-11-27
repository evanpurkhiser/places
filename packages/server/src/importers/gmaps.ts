import {importResult} from '@places/common/contract/place';

import {enqueuePlaceImport} from '../jobs/gmaps-import.ts';
import {isGoogleMapsInput} from '../services/google/index.ts';

import {type Importer, pendingStatus} from './types.ts';

export const googleImporter: Importer = {
  type: 'gmaps',
  accepts: isGoogleMapsInput,
  async enqueue(input, options, {google, jobs, db, userId}) {
    return enqueuePlaceImport(jobs, db, userId, {
      googlePlaceId: await google.resolve(input),
      ...options,
    });
  },
  getStatus(run) {
    return {
      ...pendingStatus(run),
      placeIds: run.state === 'completed' ? importResult.parse(run.output).placeIds : [],
    };
  },
};
