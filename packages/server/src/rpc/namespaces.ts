import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';
import {asc, eq} from 'drizzle-orm';

import {isUniqueViolation} from '../db/errors.ts';
import {namespaces} from '../db/schema.ts';

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
  update: namespaceWrite.update.handler(async ({input, context: {db}, errors}) => {
    const [namespace] = await db
      .update(namespaces)
      .set({name: input.name, icon: input.icon, description: input.description})
      .where(eq(namespaces.id, input.id))
      .returning();

    if (!namespace) {
      throw errors.NOT_FOUND();
    }

    return namespace;
  }),
  delete: api.delete.handler(async ({input, context: {db}, errors}) => {
    const [namespace] = await db
      .delete(namespaces)
      .where(eq(namespaces.id, input.id))
      .returning();

    if (!namespace) {
      throw errors.NOT_FOUND();
    }

    return namespace;
  }),
});
