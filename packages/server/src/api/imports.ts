import {importInput} from '@places/common/contract/place';
import {inArray} from 'drizzle-orm';
import {Hono} from 'hono';
import {z} from 'zod';

import type {Context} from '../context.ts';
import {places} from '../db/schema.ts';
import {
  ImportNotFoundError,
  ImportUnavailableError,
  InvalidImportInputError,
} from '../importers/errors.ts';
import {enqueueImport, getImportStatus} from '../importers/index.ts';
import {GoogleInputError, GoogleUnavailableError} from '../services/google/errors.ts';

const importRequest = z.object({url: importInput});
const importId = z.uuid();

async function getPlaceNames(placeIds: string[], context: Pick<Context, 'db'>) {
  if (placeIds.length === 0) {
    return [];
  }

  const records = await context.db
    .select({id: places.id, name: places.name})
    .from(places)
    .where(inArray(places.id, placeIds));
  const namesById = new Map(records.map(place => [place.id, place.name]));

  return placeIds.flatMap(id => {
    const name = namesById.get(id);
    return name === undefined ? [] : [name];
  });
}

export const importApi = new Hono<{Variables: Context}>();

importApi.onError((error, c) => {
  if (error instanceof InvalidImportInputError || error instanceof GoogleInputError) {
    return c.json({error: error.message}, 400);
  }

  if (error instanceof ImportNotFoundError) {
    return c.json({error: error.message}, 404);
  }

  if (
    error instanceof ImportUnavailableError ||
    error instanceof GoogleUnavailableError
  ) {
    return c.json({error: error.message}, 503);
  }

  throw error;
});

importApi
  .post('/', async c => {
    const body = await c.req.json().catch(() => null);
    const request = importRequest.safeParse(body);

    if (!request.success) {
      return c.json({error: 'A valid URL is required.'}, 400);
    }

    return c.json(await enqueueImport(request.data.url, c.var), 202);
  })
  .get('/:jobId', async c => {
    const jobId = importId.safeParse(c.req.param('jobId'));

    if (!jobId.success) {
      return c.json({error: 'A valid import ID is required.'}, 400);
    }

    c.header('Cache-Control', 'no-store');
    const status = await getImportStatus(jobId.data, c.var);

    return c.json({
      ...status,
      placeNames: await getPlaceNames(status.placeIds, c.var),
    });
  });
