import {implement} from '@orpc/server';
import {contract} from '@places/common/contract';
import {desc, getTableColumns, sql} from 'drizzle-orm';

import {places} from '../db/schema.ts';
import {enqueueImport, getImportStatus} from '../imports/index.ts';

import type {Context} from './context.ts';

const api = implement(contract.places).$context<Context>();

export const placeRouter = api.router({
  list: api.list.handler(async ({context: {db}}) => {
    const rows = await db
      .select({
        ...getTableColumns(places),
        latitude: sql<number>`ST_Y(${places.coordinates}::geometry)`,
        longitude: sql<number>`ST_X(${places.coordinates}::geometry)`,
      })
      .from(places)
      .orderBy(desc(places.createdAt), desc(places.id));

    return rows.map(({latitude, longitude, ...place}) => ({
      ...place,
      coordinates: {latitude, longitude},
    }));
  }),
  import: api.import.handler(({input, context}) =>
    enqueueImport(input.input, context, input.tags),
  ),
  importStatus: api.importStatus.handler(({input, context}) =>
    getImportStatus(input.jobId, context),
  ),
});
