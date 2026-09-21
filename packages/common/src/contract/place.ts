import {oc} from '@orpc/contract';
import {z} from 'zod';

import {tag, tagReference} from './tag.ts';

export const placeTag = z.object({
  placeId: z.uuid(),
  tagId: tag.shape.id,
  note: z.string().nullable(),
  createdAt: z.date(),
});
export type PlaceTag = z.infer<typeof placeTag>;

export const place = z.object({
  id: z.uuid(),
  googlePlaceId: z.string(),
  name: z.string(),
  formattedAddress: z.string(),
  googleMapsUrl: z.string().nullable(),
  coordinates: z.object({latitude: z.number(), longitude: z.number()}),
  userNote: z.string().nullable(),
  timeZone: z.string().nullable(),
  // Sorted, merged [start, end) minute offsets in the place's local week, with
  // Sunday 00:00 = 0 and week end = 10080. Week-crossing periods are split.
  // [[0, 10080]] means 24/7; [] means closed all week; null means unknown.
  hoursWeeklyOpen: z.array(z.tuple([z.number().int(), z.number().int()])).nullable(),
  businessStatus: z.string().nullable(),
  lastSync: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  tags: z.array(placeTag.extend({tag})),
});

export const googleSearchQuery = z.string().trim().min(1).max(4096);

export const importInput = z.string().trim().min(1).max(4096);
export const importType = z.enum(['gmaps', 'instagram']);
export const importResult = z.object({placeIds: z.array(z.uuid())});

const assignmentInput = z.object({placeId: place.shape.id, tag: tagReference});
export const importTag = z.object({
  tag: tagReference,
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
  searchGoogle: oc
    .errors({SERVICE_UNAVAILABLE: {message: 'Google Places search is unavailable.'}})
    .input(z.object({query: googleSearchQuery}))
    .output(
      z.array(
        place
          .pick({name: true, formattedAddress: true, googleMapsUrl: true})
          .extend({input: z.string(), primaryTypeDisplayName: z.string().nullable()}),
      ),
    ),
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
  sync: oc
    .errors({
      BAD_REQUEST: {message: 'Invalid place query.', data: queryErrorData},
      SERVICE_UNAVAILABLE: {message: 'Sync service is unavailable.'},
    })
    .input(z.object({query: z.string().optional()}).optional())
    .output(
      z.object({
        matched: z.number().int(),
        queued: z.number().int(),
        alreadyQueued: z.number().int(),
        jobIds: z.array(z.uuid()),
      }),
    ),
  syncStatus: oc
    .errors({NOT_FOUND: {message: 'Sync not found or expired.'}})
    .input(z.object({jobId: z.uuid()}))
    .output(
      z.object({
        jobId: z.uuid(),
        placeId: z.uuid(),
        state: z.enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed']),
        result: z.enum(['updated', 'unchanged', 'missing', 'superseded']).nullable(),
        error: z.string().nullable(),
      }),
    ),
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
    .errors({NOT_FOUND: {message: 'Import not found.'}})
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
