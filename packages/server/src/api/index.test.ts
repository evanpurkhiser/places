import {beforeEach, describe, expect, it, vi} from 'vitest';

import {randomUUID} from 'node:crypto';

import type {Context} from '../context.ts';
import {ImportNotFoundError} from '../importers/errors.ts';

const importers = vi.hoisted(() => ({
  enqueueImport: vi.fn(),
  getImportStatus: vi.fn(),
}));

vi.mock('../importers/index.ts', () => importers);

const {createApp} = await import('../app.ts');
const context = {} as Context;

describe('import HTTP API', () => {
  beforeEach(() => vi.resetAllMocks());

  it('queues an import', async () => {
    const jobId = randomUUID();
    importers.enqueueImport.mockResolvedValue({jobId, type: 'instagram'});
    const app = createApp(context);
    const response = await app.request('http://places.test/api/imports', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url: 'https://www.instagram.com/p/example/'}),
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      jobId,
      type: 'instagram',
    });
    expect(importers.enqueueImport).toHaveBeenCalledExactlyOnceWith(
      'https://www.instagram.com/p/example/',
      context,
    );
  });

  it('returns import status with its source ID and place names', async () => {
    const jobId = randomUUID();
    const sourceId = randomUUID();
    const placeIds = [randomUUID(), randomUUID()];
    const statusContext = {
      db: {
        select: () => ({
          from: () => ({
            where: async () => [
              {id: placeIds[1], name: 'Second Place'},
              {id: placeIds[0], name: 'First Place'},
            ],
          }),
        }),
      },
    } as unknown as Context;
    importers.getImportStatus.mockResolvedValue({
      jobId,
      type: 'instagram',
      sourceId,
      state: 'completed',
      placeIds,
      error: null,
    });
    const app = createApp(statusContext);
    const response = await app.request(`/api/imports/${jobId}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      jobId,
      type: 'instagram',
      sourceId,
      state: 'completed',
      placeIds,
      placeNames: ['First Place', 'Second Place'],
      error: null,
    });
    expect(importers.getImportStatus).toHaveBeenCalledExactlyOnceWith(
      jobId,
      statusContext,
    );
  });

  it('rejects invalid requests before importing', async () => {
    const app = createApp(context);
    const response = await app.request('/api/imports', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url: ''}),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'A valid URL is required.',
    });
    expect(importers.enqueueImport).not.toHaveBeenCalled();
  });

  it('returns API errors as HTTP errors', async () => {
    const jobId = randomUUID();
    importers.getImportStatus.mockRejectedValue(
      new ImportNotFoundError('Import not found.'),
    );
    const app = createApp(context);
    const response = await app.request(`/api/imports/${jobId}`);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({error: 'Import not found.'});
  });
});
