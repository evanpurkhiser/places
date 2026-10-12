import {oc} from '@orpc/contract';
import {z} from 'zod';

import {namespaceId, tagId} from './identifiers.ts';
export const tagIcon = z.strictObject({
  emoji: z.string().trim().min(1).describe('Emoji displayed for the tag.'),
});

export type TagIcon = z.infer<typeof tagIcon>;

const normalizedTagName = z.string().trim().toLowerCase().min(1);

export const tagReference = normalizedTagName.describe(
  'Existing tag name, qualified namespace.tag name, or tag UUID.',
);

export const tag = z.object({
  id: tagId,
  name: normalizedTagName
    .refine(
      name => {
        const parts = name.split('.');
        return (
          parts.length <= 2 &&
          parts.every(part => part.length > 0 && part === part.trim())
        );
      },
      {message: 'Use a tag name or namespace.tag with nonempty, trimmed parts'},
    )
    .describe('Unique lowercase tag name. Namespaced tags use the namespace.tag form.'),
  namespaceId: namespaceId
    .nullable()
    .describe('Owning namespace UUID, or null for an unqualified tag.'),
  archived: z.boolean().describe('Whether the tag is hidden from active tag lists.'),
  icon: tagIcon
    .nullable()
    .describe('Tag icon, or null when unset. Pass null to clear the icon.'),
  description: z
    .string()
    .nullable()
    .describe('Tag description, or null when unset. Pass null to clear it.'),
  createdAt: z.date().describe('Time the tag was created.'),
  updatedAt: z.date().describe('Time the tag was last updated.'),
});

const existingTag = oc.errors({NOT_FOUND: {message: 'Tag not found'}});
const writableTag = oc.errors({
  CONFLICT: {message: 'A tag with this name already exists'},
  NAMESPACE_NOT_FOUND: {message: 'Namespace not found'},
});

export const tagContract = {
  list: oc.output(z.array(tag)),
  get: existingTag.input(tag.pick({id: true})).output(tag),
  create: writableTag
    .input(
      tag
        .pick({name: true, icon: true, description: true})
        .partial({icon: true, description: true}),
    )
    .output(tag),
  update: writableTag
    .errors({NOT_FOUND: {message: 'Tag not found'}})
    .input(
      tag
        .pick({id: true, name: true, icon: true, description: true, archived: true})
        .partial({name: true, icon: true, description: true, archived: true})
        .refine(
          input =>
            input.name !== undefined ||
            input.icon !== undefined ||
            input.description !== undefined ||
            input.archived !== undefined,
          {message: 'Provide a name, icon, description, or archived state to update'},
        ),
    )
    .output(tag),
  delete: existingTag.input(tag.pick({id: true})).output(tag),
};
