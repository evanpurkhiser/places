import {oc} from '@orpc/contract';
import {z} from 'zod';

import {namespaceId} from './identifiers.ts';
import {mcpTools} from './mcp.ts';
import {tagIcon} from './tag.ts';

export const namespace = z.object({
  id: namespaceId,
  name: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .refine(name => !name.includes('.'), {
      message: 'Namespace names cannot contain dots',
    })
    .describe('Unique lowercase namespace name without dots.'),
  icon: tagIcon
    .nullable()
    .describe('Namespace icon, or null when unset. Pass null to clear the icon.'),
  description: z
    .string()
    .nullable()
    .describe('Namespace description, or null when unset. Pass null to clear it.'),
  createdAt: z.date().describe('Time the namespace was created.'),
  updatedAt: z.date().describe('Time the namespace was last updated.'),
});

const existingNamespace = oc.errors({NOT_FOUND: {message: 'Namespace not found'}});
const writableNamespace = oc.errors({
  CONFLICT: {message: 'A namespace with this name already exists'},
});

export const namespaceContract = {
  list: oc.meta(mcpTools.namespaces.list).output(z.array(namespace)),
  get: existingNamespace
    .meta(mcpTools.namespaces.get)
    .input(namespace.pick({id: true}))
    .output(namespace),
  create: writableNamespace
    .meta(mcpTools.namespaces.create)
    .input(
      namespace
        .pick({name: true, icon: true, description: true})
        .partial({icon: true, description: true}),
    )
    .output(namespace),
  update: writableNamespace
    .meta(mcpTools.namespaces.update)
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
    .meta(mcpTools.namespaces.delete)
    .errors({
      CONFLICT: {
        message: 'Namespace contains tags',
      },
    })
    .input(
      namespace.pick({id: true}).extend({
        force: z
          .boolean()
          .default(false)
          .describe(
            'Unlink contained tags and remove their namespace prefixes before deletion.',
          ),
      }),
    )
    .output(namespace),
};
