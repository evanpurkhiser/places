import {namespace} from '@places/common/contract/namespace';
import {tag} from '@places/common/contract/tag';
import {z} from 'zod';

import {instagramCaptureConfig, instagramConfig} from '../../config/instagram.ts';

import {transcriptSegments} from './transcribing.ts';

export const captureCatalog = z.object({
  tags: z.array(tag.pick({id: true, name: true, namespaceId: true, description: true})),
  namespaces: z.array(namespace.pick({id: true, name: true, description: true})),
});
export type CaptureCatalog = z.infer<typeof captureCatalog>;

export const captureContent = z.strictObject({
  caption: z.string().max(30000),
  location: z.string().max(1000).nullable().default(null),
  media: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        id: z.string(),
        kind: z.literal('image'),
        image: z.string().regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
      }),
      z.object({
        id: z.string(),
        kind: z.literal('video'),
        durationSeconds: z.number().positive(),
        transcript: transcriptSegments,
      }),
    ]),
  ),
});
export type CaptureContent = z.input<typeof captureContent>;

export const captureOptions = instagramCaptureConfig.extend({
  excludedTags: instagramConfig.shape.excludedTags,
  excludedNamespaces: instagramConfig.shape.excludedNamespaces,
  requiredNamespaces: instagramConfig.shape.requiredNamespaces,
});
export type CaptureOptions = z.input<typeof captureOptions>;
export type ParsedCaptureOptions = z.output<typeof captureOptions>;

/**
 * Apply the caller's namespace and tag exclusions to the supplied catalog.
 */
export function assignableTags(catalog: CaptureCatalog, options: ParsedCaptureOptions) {
  const excludedIds = new Set(
    catalog.namespaces
      .filter(group => options.excludedNamespaces.includes(group.name))
      .map(group => group.id),
  );

  return catalog.tags.filter(
    item =>
      !options.excludedTags.includes(item.name) &&
      !excludedIds.has(item.namespaceId ?? ''),
  );
}

/**
 * Build a structured-output schema restricted to the assignable tag names.
 */
export function captureOutput(tags: CaptureCatalog['tags']) {
  // An empty catalog still permits extracting untagged places.
  const assignments =
    tags.length > 0
      ? z.array(z.enum(tags.map(item => item.name)))
      : z.array(z.string()).max(0);

  return z.strictObject({
    description: z
      .string()
      .min(1)
      .describe('A short, standalone summary of the post as a whole.'),
    places: z
      .array(
        z.strictObject({
          googlePlaceId: z.string().min(1),
          tags: assignments,
          description: z
            .string()
            .min(1)
            .describe(
              "A concise summary of the creator's recommendation for this place.",
            ),
          evidence: z
            .string()
            .min(1)
            .describe(
              'Concise supporting caption/transcript excerpt or visual evidence, with a media ID and video timestamp when available.',
            ),
          matchReason: z
            .string()
            .min(1)
            .describe(
              'Evidence connecting the recommended place to this Google Maps candidate and branch.',
            ),
        }),
      )
      .max(50),
    unresolved: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          reason: z.string().min(1),
        }),
      )
      .max(50),
  });
}
