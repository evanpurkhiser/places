import {oc} from '@orpc/contract';
import {z} from 'zod';

export const tagIcon = z.strictObject({
  emoji: z.string().trim().min(1),
});

export type TagIcon = z.infer<typeof tagIcon>;

export const tag = z.object({
  id: z.uuid(),
  name: z.string().trim().toLowerCase().min(1),
  icon: tagIcon.nullable(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const existingTag = oc.errors({NOT_FOUND: {message: 'Tag not found'}});
const writableTag = oc.errors({
  CONFLICT: {message: 'A tag with this name already exists'},
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
