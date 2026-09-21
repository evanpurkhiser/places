import {oc} from '@orpc/contract';
import {z} from 'zod';

export const tagIcon = z.strictObject({
  emoji: z.string().trim().min(1),
});

export type TagIcon = z.infer<typeof tagIcon>;

export const tagReference = z.string().trim().toLowerCase().min(1);

export const tag = z.object({
  id: z.uuid(),
  name: tagReference.refine(
    name => {
      const parts = name.split('.');
      return (
        parts.length <= 2 && parts.every(part => part.length > 0 && part === part.trim())
      );
    },
    {message: 'Use a tag name or namespace.tag with nonempty, trimmed parts'},
  ),
  namespaceId: z.uuid().nullable(),
  icon: tagIcon.nullable(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const existingTag = oc.errors({NOT_FOUND: {message: 'Tag not found'}});
const writableTag = oc.errors({
  CONFLICT: {message: 'A tag with this name already exists'},
  NAMESPACE_NOT_FOUND: {status: 404, message: 'Namespace not found'},
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
        .pick({id: true, name: true, icon: true, description: true})
        .partial({name: true, icon: true, description: true})
        .refine(
          input =>
            input.name !== undefined ||
            input.icon !== undefined ||
            input.description !== undefined,
          {message: 'Provide a name, icon, or description to update'},
        ),
    )
    .output(tag),
  delete: existingTag.input(tag.pick({id: true})).output(tag),
};
