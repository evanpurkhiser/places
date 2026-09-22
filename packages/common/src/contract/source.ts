import {z} from 'zod';

/**
 * Instagram post metadata used to display a source card.
 */
export const instagramSourceData = z.strictObject({
  caption: z.string(),
  username: z.string().min(1).nullable(),
  postedAt: z.iso.datetime().nullable(),
  thumbnailUrl: z.url().nullable(),
});
export type InstagramSourceData = z.infer<typeof instagramSourceData>;

export const sourceType = z.literal('instagram');

const sourceFields = z.object({
  id: z.uuid(),
  externalId: z.string().min(1).nullable(),
  url: z.url().nullable(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Validate source metadata together with the provider that defines its shape.
 * Sources saved without provider metadata have null data.
 */
export const source = z.discriminatedUnion('type', [
  sourceFields.extend({
    type: sourceType,
    data: instagramSourceData.nullable(),
  }),
]);
export type Source = z.infer<typeof source>;

/**
 * Recommendation details attached to an existing source and a saved place.
 */
export const placeSourceInput = z.object({
  sourceId: z.uuid(),
  description: z.string().nullable().optional(),
  data: z.record(z.string(), z.json()).nullable().optional(),
});
export type PlaceSourceInput = z.infer<typeof placeSourceInput>;
