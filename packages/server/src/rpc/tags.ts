import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';
import {asc, eq} from 'drizzle-orm';

import {isUniqueViolation} from '../db/errors.ts';
import type {Database} from '../db/index.ts';
import {namespaces, tags} from '../db/schema.ts';

import type {Context} from './context.ts';

const api = implement(contract.tags).$context<Context>();

const tagWrite = implement({
  create: contract.tags.create,
  update: contract.tags.update,
})
  .$context<Context>()
  .use(async ({next, errors}) => {
    try {
      return await next();
    } catch (error) {
      if (isUniqueViolation(error, 'tags_name_unique')) {
        throw errors.CONFLICT();
      }

      throw error;
    }
  });

export const tagRouter = api.router({
  list: api.list.handler(({context: {db}}) =>
    db.select().from(tags).orderBy(asc(tags.name)),
  ),
  get: api.get.handler(async ({input, context: {db}, errors}) => {
    const [tag] = await db.select().from(tags).where(eq(tags.id, input.id));

    if (!tag) {
      throw errors.NOT_FOUND();
    }

    return tag;
  }),
  create: tagWrite.create.handler(({input, context: {db}, errors}) =>
    db.transaction(async tx => {
      const membership = await tagNamespace(tx, input.name);

      if (!membership) {
        throw errors.NAMESPACE_NOT_FOUND();
      }

      const [tag] = await tx
        .insert(tags)
        .values({...input, ...membership})
        .returning();
      return tag!;
    }),
  ),
  update: tagWrite.update.handler(({input, context: {db}, errors}) =>
    db.transaction(async tx => {
      const membership =
        input.name === undefined ? {} : await tagNamespace(tx, input.name);

      if (!membership) {
        throw errors.NAMESPACE_NOT_FOUND();
      }

      const [tag] = await tx
        .update(tags)
        .set({
          name: input.name,
          icon: input.icon,
          description: input.description,
          ...membership,
        })
        .where(eq(tags.id, input.id))
        .returning();

      if (!tag) {
        throw errors.NOT_FOUND();
      }

      return tag;
    }),
  ),
  delete: api.delete.handler(async ({input, context: {db}, errors}) => {
    const [tag] = await db.delete(tags).where(eq(tags.id, input.id)).returning();

    if (!tag) {
      throw errors.NOT_FOUND();
    }

    return tag;
  }),
});

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

async function tagNamespace(tx: Transaction, name: string) {
  const [prefix, localName] = name.split('.');

  if (localName === undefined) {
    return {namespaceId: null};
  }

  // Keep the prefix stable until the tag write commits. Namespace renames take
  // an exclusive row lock before rewriting their tags' qualified names.
  const [namespace] = await tx
    .select({id: namespaces.id})
    .from(namespaces)
    .where(eq(namespaces.name, prefix!))
    .for('share');

  return namespace ? {namespaceId: namespace.id} : undefined;
}
