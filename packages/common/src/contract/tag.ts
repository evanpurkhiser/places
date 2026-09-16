import {oc} from '@orpc/contract';
import {z} from 'zod';

export const tag = z.object({
  id: z.uuid(),
  name: z.string().trim().toLowerCase().min(1),
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
  create: writableTag.input(tag.pick({name: true})).output(tag),
  update: writableTag
    .errors({NOT_FOUND: {message: 'Tag not found'}})
    .input(tag.pick({id: true, name: true}))
    .output(tag),
  delete: existingTag.input(tag.pick({id: true})).output(tag),
};
