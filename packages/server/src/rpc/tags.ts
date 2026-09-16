import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';
import {asc, eq} from 'drizzle-orm';

import {isUniqueViolation} from '../db/errors.ts';
import {tags} from '../db/schema.ts';

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
  create: tagWrite.create.handler(async ({input, context: {db}}) => {
    const [tag] = await db.insert(tags).values(input).returning();

    return tag!;
  }),
  update: tagWrite.update.handler(async ({input, context: {db}, errors}) => {
    const [tag] = await db
      .update(tags)
      .set({name: input.name})
      .where(eq(tags.id, input.id))
      .returning();

    if (!tag) {
      throw errors.NOT_FOUND();
    }

    return tag;
  }),
  delete: api.delete.handler(async ({input, context: {db}, errors}) => {
    const [tag] = await db.delete(tags).where(eq(tags.id, input.id)).returning();

    if (!tag) {
      throw errors.NOT_FOUND();
    }

    return tag;
  }),
});
