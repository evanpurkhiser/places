import {oc} from '@orpc/contract';
import {z} from 'zod';

export const place = z.object({
  id: z.uuid(),
  googlePlaceId: z.string(),
  name: z.string(),
  formattedAddress: z.string(),
  googleMapsUrl: z.string().nullable(),
  coordinates: z.object({latitude: z.number(), longitude: z.number()}),
  userNote: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const importInput = z.string().trim().min(1).max(4096);
export const importType = z.enum(['gmaps']);
export const importResult = z.object({placeIds: z.array(z.uuid())});

export const placeContract = {
  list: oc.output(z.array(place)),
  import: oc
    .errors({
      BAD_REQUEST: {message: 'Unsupported or invalid import input.'},
      SERVICE_UNAVAILABLE: {message: 'Import service is unavailable.'},
    })
    .input(z.object({input: importInput}))
    .output(
      z.object({
        jobId: z.uuid(),
        type: importType,
      }),
    ),
  importStatus: oc
    .errors({NOT_FOUND: {message: 'Import not found or expired.'}})
    .input(z.object({jobId: z.uuid()}))
    .output(
      z.object({
        jobId: z.uuid(),
        type: importType,
        state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
        placeIds: importResult.shape.placeIds,
        error: z.string().nullable(),
      }),
    ),
};
