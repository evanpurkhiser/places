import {oc} from '@orpc/contract';
import {z} from 'zod';

import {tag} from './tag.ts';

export const place = z.object({
  id: z.uuid(),
  googlePlaceId: z.string(),
  name: z.string(),
  formattedAddress: z.string(),
  googleMapsUrl: z.string().nullable(),
  coordinates: z.object({latitude: z.number(), longitude: z.number()}),
  userNote: z.string().nullable(),
  timeZone: z.string().nullable(),
  hoursWeeklyOpen: z.array(z.tuple([z.number().int(), z.number().int()])).nullable(),
  businessStatus: z.string().nullable(),
  lastSync: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const importInput = z.string().trim().min(1).max(4096);
export const importType = z.enum(['gmaps']);
export const importResult = z.object({placeIds: z.array(z.uuid())});

const assignmentInput = z.object({placeId: place.shape.id, tag: tag.shape.name});
export const placeTag = z.object({
  placeId: place.shape.id,
  tagId: tag.shape.id,
  note: z.string().nullable(),
  createdAt: z.date(),
});
export type PlaceTag = z.infer<typeof placeTag>;

export const importTag = z.object({
  tag: tag.shape.name,
  note: placeTag.shape.note.unwrap().optional(),
});
export type ImportTag = z.infer<typeof importTag>;

const position = z.object({
  offset: z.number().int().nonnegative(),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
});

export const queryErrorData = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      location: z.object({start: position, end: position}),
    }),
  ),
});

const assignmentAction = oc.errors({NOT_FOUND: {message: 'Place or tag not found'}});

export const placeContract = {
  tag: assignmentAction
    .input(assignmentInput.extend({notes: z.string().optional()}))
    .output(placeTag),
  untag: assignmentAction
    .input(assignmentInput)
    .output(placeTag.pick({placeId: true, tagId: true}).extend({removed: z.boolean()})),
  list: oc
    .errors({
      BAD_REQUEST: {message: 'Invalid place query.', data: queryErrorData},
      SERVICE_UNAVAILABLE: {message: 'Place resolution is unavailable.'},
    })
    .input(z.object({query: z.string().optional()}).optional())
    .output(z.array(place)),
  import: oc
    .errors({
      BAD_REQUEST: {message: 'Unsupported or invalid import input.'},
      SERVICE_UNAVAILABLE: {message: 'Import service is unavailable.'},
    })
    .input(
      z.object({
        input: importInput,
        tags: z.array(importTag).default([]),
        notes: z.string().optional(),
      }),
    )
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
