import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';
import {asc, eq, sql} from 'drizzle-orm';

import {isForeignKeyViolation, isUniqueViolation} from '../db/errors.ts';
import {namespaces, tags} from '../db/schema.ts';

import type {Context} from './context.ts';

const api = implement(contract.namespaces).$context<Context>();

const namespaceWrite = implement({
  create: contract.namespaces.create,
  update: contract.namespaces.update,
})
  .$context<Context>()
  .use(async ({next, errors}) => {
    try {
      return await next();
    } catch (error) {
      if (isUniqueViolation(error, 'namespaces_name_unique')) {
        throw errors.CONFLICT();
      }

      throw error;
    }
  });

export const namespaceRouter = api.router({
  list: api.list.handler(({context: {db}}) =>
    db.select().from(namespaces).orderBy(asc(namespaces.name)),
  ),
  get: api.get.handler(async ({input, context: {db}, errors}) => {
    const [namespace] = await db
      .select()
      .from(namespaces)
      .where(eq(namespaces.id, input.id));

    if (!namespace) {
      throw errors.NOT_FOUND();
    }

    return namespace;
  }),
  create: namespaceWrite.create.handler(async ({input, context: {db}}) => {
    const [namespace] = await db.insert(namespaces).values(input).returning();

    return namespace!;
  }),
  update: namespaceWrite.update.handler(({input, context: {db}, errors}) =>
    db.transaction(async tx => {
      const [namespace] = await tx
        .update(namespaces)
        .set({name: input.name, icon: input.icon, description: input.description})
        .where(eq(namespaces.id, input.id))
        .returning();

      if (!namespace) {
        throw errors.NOT_FOUND();
      }

      if (input.name !== undefined) {
        await tx
          .update(tags)
          .set({name: sql`${namespace.name} || ':' || split_part(${tags.name}, ':', 2)`})
          .where(eq(tags.namespaceId, namespace.id));
      }

      return namespace;
    }),
  ),
  delete: api.delete
    .use(async ({next, errors}) => {
      try {
        return await next();
      } catch (error) {
        if (isForeignKeyViolation(error, 'tags_namespace_id_namespaces_id_fk')) {
          throw errors.CONFLICT();
        }

        if (isUniqueViolation(error, 'tags_name_unique')) {
          throw errors.CONFLICT({
            message: 'Cannot unlink tags: a bare tag name already exists',
          });
        }

        throw error;
      }
    })
    .handler(({input, context: {db}, errors}) =>
      db.transaction(async tx => {
        const [namespace] = await tx
          .select()
          .from(namespaces)
          .where(eq(namespaces.id, input.id))
          .for('update');

        if (!namespace) {
          throw errors.NOT_FOUND();
        }

        if (input.force) {
          await tx
            .update(tags)
            .set({namespaceId: null, name: sql`split_part(${tags.name}, ':', 2)`})
            .where(eq(tags.namespaceId, namespace.id));
        }

        await tx.delete(namespaces).where(eq(namespaces.id, namespace.id));
        return namespace;
      }),
    ),
});
