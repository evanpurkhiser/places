import {oc} from '@orpc/contract';
import {z} from 'zod';

import {tagIcon} from './tag.ts';

export const namespace = z.object({
  id: z.uuid(),
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .refine(name => !name.includes('.'), {
      message: 'Namespace names cannot contain dots',
    }),
  icon: tagIcon.nullable(),
  description: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const existingNamespace = oc.errors({NOT_FOUND: {message: 'Namespace not found'}});
const writableNamespace = oc.errors({
  CONFLICT: {message: 'A namespace with this name already exists'},
});

export const namespaceContract = {
  list: oc.output(z.array(namespace)),
  get: existingNamespace.input(namespace.pick({id: true})).output(namespace),
  create: writableNamespace
    .input(
      namespace
        .pick({name: true, icon: true, description: true})
        .partial({icon: true, description: true}),
    )
    .output(namespace),
  update: writableNamespace
    .errors({NOT_FOUND: {message: 'Namespace not found'}})
    .input(
      namespace
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
    .output(namespace),
  delete: existingNamespace
    .errors({
      CONFLICT: {
        message: 'Namespace contains tags',
      },
    })
    .input(namespace.pick({id: true}).extend({force: z.boolean().default(false)}))
    .output(namespace),
};
