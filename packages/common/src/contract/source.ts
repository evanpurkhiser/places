import {z} from 'zod';

import {sourceId} from './identifiers.ts';

/**
 * Instagram post metadata used to display a source card.
 */
export const instagramSourceData = z.strictObject({
  caption: z.string().describe('Instagram post caption.'),
  username: z.string().min(1).nullable().describe('Instagram account username.'),
  postedAt: z.iso
    .datetime()
    .nullable()
    .describe('ISO 8601 post publication time, or null when unavailable.'),
  thumbnailUrl: z
    .url()
    .nullable()
    .describe('Post thumbnail URL, or null when unavailable.'),
});
export type InstagramSourceData = z.infer<typeof instagramSourceData>;

export const sourceType = z.literal('instagram').describe('Source provider type.');

const sourceFields = z.object({
  id: sourceId,
  externalId: z
    .string()
    .min(1)
    .nullable()
    .describe('Provider-specific source identifier, or null when unavailable.'),
  url: z.url().nullable().describe('Canonical source URL, or null when unavailable.'),
  description: z
    .string()
    .nullable()
    .describe('Source-level recommendation text, or null when unset.'),
  createdAt: z.date().describe('Time the source was created.'),
  updatedAt: z.date().describe('Time the source was last updated.'),
});

/**
 * Validate source metadata together with the provider that defines its shape.
 * Sources saved without provider metadata have null data.
 */
export const source = z.discriminatedUnion('type', [
  sourceFields.extend({
    type: sourceType,
    data: instagramSourceData
      .nullable()
      .describe('Instagram metadata, or null when unavailable.'),
  }),
]);
export type Source = z.infer<typeof source>;

export const placeSourceDescription = z
  .string()
  .nullable()
  .describe('Recommendation text specific to this place, or null when unset.');
export const placeSourceData = z
  .record(z.string(), z.json())
  .nullable()
  .describe('Provider-specific association metadata, or null when unavailable.');

/**
 * Recommendation details attached to an existing source and a saved place.
 */
export const placeSourceInput = z.object({
  sourceId: sourceId.describe('Source UUID to associate with a place.'),
  description: placeSourceDescription.optional(),
  data: placeSourceData.optional(),
});
export type PlaceSourceInput = z.infer<typeof placeSourceInput>;
