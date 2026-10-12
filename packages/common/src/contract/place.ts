import {oc} from '@orpc/contract';
import {z} from 'zod';

import {importJobId, placeId, sourceId, syncJobId, tagId} from './identifiers.ts';
import {mcpTools} from './mcp.ts';
import {placeSourceData, placeSourceDescription, source} from './source.ts';
import {tag, tagReference} from './tag.ts';

export const placeTagNote = z
  .string()
  .nullable()
  .describe('Tag assignment note, or null when unset.');
export const placeUserNote = z
  .string()
  .nullable()
  .describe('User-authored note for the place, or null when unset.');

export const placeTag = z.object({
  placeId,
  tagId,
  note: placeTagNote,
  createdAt: z.date().describe('Time the tag was assigned to the place.'),
});
export type PlaceTag = z.infer<typeof placeTag>;

export const placeSource = z.object({
  placeId,
  sourceId,
  description: placeSourceDescription,
  data: placeSourceData,
  createdAt: z.date().describe('Time the source was associated with the place.'),
  updatedAt: z.date().describe('Time the source association was last updated.'),
  source: source.describe('Source record associated with the place.'),
});
export type PlaceSource = z.infer<typeof placeSource>;

export const place = z.object({
  id: placeId,
  googlePlaceId: z.string().describe('Google Places identifier.'),
  name: z.string().describe('Display name of the place.'),
  formattedAddress: z.string().describe('Formatted street address.'),
  googleMapsUrl: z
    .string()
    .nullable()
    .describe('Google Maps URL, or null when unavailable.'),
  coordinates: z
    .object({
      latitude: z.number().describe('Latitude in decimal degrees.'),
      longitude: z.number().describe('Longitude in decimal degrees.'),
    })
    .describe('Geographic coordinates of the place.'),
  userNote: placeUserNote,
  timeZone: z
    .string()
    .nullable()
    .describe('IANA time zone name, or null when unavailable.'),
  // Sorted, merged [start, end) minute offsets in the place's local week, with
  // Sunday 00:00 = 0 and week end = 10080. Week-crossing periods are split.
  // [[0, 10080]] means 24/7; [] means closed all week; null means unknown.
  hoursWeeklyOpen: z
    .array(z.tuple([z.number().int(), z.number().int()]))
    .nullable()
    .describe(
      'Sorted weekly opening intervals as [start, end) minute offsets from Sunday 00:00, or null when unknown.',
    ),
  businessStatus: z
    .string()
    .nullable()
    .describe('Google business status, or null when unavailable.'),
  lastSync: z.date().nullable().describe('Time Google metadata was last refreshed.'),
  createdAt: z.date().describe('Time the place was saved.'),
  updatedAt: z.date().describe('Time the place was last updated.'),
  tags: z
    .array(placeTag.extend({tag: tag.describe('Assigned tag.')}))
    .describe('Active tag assignments.'),
  sources: z.array(placeSource).describe('Sources associated with the place.'),
});

export const placeSortField = z.enum([
  'name',
  'recently-saved',
  'recently-recommended',
  'distance',
]);
export const placeSortDirection = z.enum(['asc', 'desc']);
export const placeSort = z
  .union([placeSortField, z.templateLiteral([placeSortField, '-', placeSortDirection])])
  .describe(
    'Sort order. Bare name and distance sort ascending; bare recency fields sort descending. Append -asc or -desc to override.',
  );
export type PlaceSort = z.infer<typeof placeSort>;

export const referenceLocation = z
  .string()
  .min(1)
  .max(4096)
  .describe(
    'Location used as @ref in geographic filters or distance sorting. Accepts a place name or point(longitude, latitude).',
  );

export const googleSearchQuery = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .describe('Google Maps search terms, including a city or neighborhood when useful.');

export const importInput = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .describe(
    'Google Maps URL, gmaps:<place_id> reference, or Instagram post or reel URL.',
  );
export const importType = z
  .enum(['gmaps', 'instagram'])
  .describe('Provider selected for the import.');
const jobState = z
  .enum(['created', 'retry', 'active', 'completed', 'cancelled', 'failed'])
  .describe('Current background job state.');
const jobError = z
  .string()
  .nullable()
  .describe('Safe failure summary, or null when none.');
export const importResult = z.object({
  placeIds: z.array(placeId).describe('Saved place UUIDs produced by the import.'),
});
export const importStatus = z.object({
  jobId: importJobId,
  type: importType,
  state: jobState,
  placeIds: importResult.shape.placeIds,
  error: jobError,
});
const importRunsInput = z
  .object({
    limit: z
      .number()
      .int()
      .positive()
      .default(50)
      .describe('Maximum number of recent import runs to return.'),
  })
  .default({limit: 50});

const assignmentInput = z.object({placeId, tag: tagReference});
export const importTag = z.object({
  tag: tagReference,
  note: placeTagNote
    .unwrap()
    .optional()
    .describe('Assignment note for this tag. An empty string clears the note.'),
});
export type ImportTag = z.infer<typeof importTag>;

const position = z
  .object({
    offset: z.number().int().nonnegative().describe('Zero-based character offset.'),
    line: z.number().int().positive().describe('One-based line number.'),
    column: z.number().int().positive().describe('One-based column number.'),
  })
  .describe('Position in the query source text.');

export const queryErrorData = z.object({
  diagnostics: z.array(
    z.object({
      code: z.string().describe('Stable diagnostic code.'),
      message: z.string().describe('Human-readable diagnostic message.'),
      location: z
        .object({start: position, end: position})
        .describe('Source range containing the query error.'),
    }),
  ),
});

const assignmentAction = oc.errors({NOT_FOUND: {message: 'Place or tag not found'}});
const queryInput = z.object({
  query: z
    .string()
    .optional()
    .describe(
      'Place query expression. Use query_describe to discover filters, functions, values, and examples.',
    ),
  referenceLocation: referenceLocation.optional(),
});
const placeListInput = queryInput
  .extend({sort: placeSort.optional()})
  .refine(
    input => !input.sort?.startsWith('distance') || input.referenceLocation !== undefined,
    {
      message: 'Distance sorting requires a reference location.',
      path: ['referenceLocation'],
    },
  );

export const placeContract = {
  searchGoogle: oc
    .meta(mcpTools.places.searchGoogle)
    .errors({SERVICE_UNAVAILABLE: {message: 'Google Places search is unavailable.'}})
    .input(z.object({query: googleSearchQuery}))
    .output(
      z.array(
        place.pick({name: true, formattedAddress: true, googleMapsUrl: true}).extend({
          input: z.string().describe('Import reference for this Google Maps result.'),
          primaryTypeDisplayName: z
            .string()
            .nullable()
            .describe('Google primary place type label, or null when unavailable.'),
        }),
      ),
    ),
  tag: assignmentAction
    .meta(mcpTools.places.tag)
    .input(
      assignmentInput.extend({
        notes: placeTagNote
          .unwrap()
          .optional()
          .describe(
            'Assignment note. Omit to preserve the existing note; pass an empty string to clear it.',
          ),
      }),
    )
    .output(placeTag),
  untag: assignmentAction
    .meta(mcpTools.places.untag)
    .input(assignmentInput)
    .output(
      placeTag.pick({placeId: true, tagId: true}).extend({
        removed: z.boolean().describe('Whether an existing assignment was removed.'),
      }),
    ),
  list: oc
    .meta(mcpTools.places.list)
    .errors({
      BAD_REQUEST: {message: 'Invalid place query.', data: queryErrorData},
      SERVICE_UNAVAILABLE: {message: 'Place resolution is unavailable.'},
    })
    .input(placeListInput.optional())
    .output(z.array(place)),
  sync: oc
    .errors({
      BAD_REQUEST: {message: 'Invalid place query.', data: queryErrorData},
      SERVICE_UNAVAILABLE: {message: 'Sync service is unavailable.'},
    })
    .input(queryInput.optional())
    .output(
      z.object({
        matched: z.number().int().describe('Number of places matching the filter.'),
        queued: z.number().int().describe('Number of new sync jobs queued.'),
        alreadyQueued: z
          .number()
          .int()
          .describe('Number of matching places with an existing queued sync.'),
        jobIds: z.array(syncJobId).describe('UUIDs of newly queued sync jobs.'),
      }),
    ),
  syncStatus: oc
    .meta(mcpTools.places.syncStatus)
    .errors({NOT_FOUND: {message: 'Sync not found or expired.'}})
    .input(z.object({jobId: syncJobId}))
    .output(
      z.object({
        jobId: syncJobId,
        placeId,
        state: jobState,
        result: z
          .enum(['updated', 'unchanged', 'missing', 'superseded'])
          .nullable()
          .describe('Completed sync result, or null while unfinished.'),
        error: jobError,
      }),
    ),
  import: oc
    .meta(mcpTools.places.import)
    .errors({
      BAD_REQUEST: {message: 'Unsupported or invalid import input.'},
      SERVICE_UNAVAILABLE: {message: 'Import service is unavailable.'},
    })
    .input(
      z.object({
        input: importInput,
        tags: z
          .array(importTag)
          .default([])
          .describe('Existing tags to apply when the import creates a place.'),
        notes: placeUserNote
          .unwrap()
          .optional()
          .describe('User note for the imported place. An empty string clears the note.'),
      }),
    )
    .output(
      z.object({
        jobId: importJobId.describe('Queued import job UUID.'),
        type: importType,
      }),
    ),
  getImportRun: oc
    .meta(mcpTools.places.getImportRun)
    .errors({NOT_FOUND: {message: 'Import not found.'}})
    .input(z.object({jobId: importJobId}))
    .output(importStatus),
  listImportRuns: oc
    .meta(mcpTools.places.listImportRuns)
    .input(importRunsInput)
    .output(z.array(importStatus)),
};
