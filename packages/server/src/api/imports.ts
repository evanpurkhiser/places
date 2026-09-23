import {importInput} from '@places/common/contract/place';
import {Hono} from 'hono';
import {z} from 'zod';

import type {Context} from '../context.ts';
import {
  ImportNotFoundError,
  ImportUnavailableError,
  InvalidImportInputError,
} from '../importers/errors.ts';
import {enqueueImport, getImportStatus} from '../importers/index.ts';
import {GoogleInputError, GoogleUnavailableError} from '../services/google/errors.ts';

const importRequest = z.object({url: importInput});
const importId = z.uuid();

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

    const result = await enqueueImport(request.data.url, c.var);
    const statusUrl = new URL(`/api/imports/${result.jobId}`, c.req.url).href;
    c.header('Location', statusUrl);

    return c.json({...result, statusUrl}, 202);
  })
  .get('/:jobId', async c => {
    const jobId = importId.safeParse(c.req.param('jobId'));

    if (!jobId.success) {
      return c.json({error: 'A valid import ID is required.'}, 400);
    }

    c.header('Cache-Control', 'no-store');
    return c.json(await getImportStatus(jobId.data, c.var));
  });
