import {z} from 'zod';

export const placeId = z.uuid().describe('Saved place UUID.');
export const tagId = z.uuid().describe('Tag UUID.');
export const namespaceId = z.uuid().describe('Tag namespace UUID.');
export const sourceId = z.uuid().describe('Source UUID.');
export const importJobId = z.uuid().describe('Import job UUID.');
export const syncJobId = z.uuid().describe('Sync job UUID.');
