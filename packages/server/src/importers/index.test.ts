import {describe, expect, it, vi} from 'vitest';

import type {Context} from '../context.ts';

import {getImportStatus, listImportStatuses} from './index.ts';
import type {ImportRun} from './types.ts';

const googleRunId = '00000000-0000-4000-8000-000000000001';
const instagramRunId = '00000000-0000-4000-8000-000000000002';
const skippedRunId = '00000000-0000-4000-8000-000000000003';
const sourceId = '00000000-0000-4000-8000-000000000004';
const importedPlaceId = '00000000-0000-4000-8000-000000000005';
const savedPlaceId = '00000000-0000-4000-8000-000000000006';

function importRun(overrides: Pick<ImportRun, 'id' | 'type'> & Partial<ImportRun>) {
  return {
    state: 'created',
    sourceId: null,
    input: {},
    output: null,
    error: null,
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date('2026-09-23T12:00:00Z'),
    updatedAt: new Date('2026-09-23T12:00:00Z'),
    ...overrides,
  } satisfies ImportRun;
}

describe('listing import runs', () => {
  it('batches completed Instagram status lookups', async () => {
    const runs = [
      importRun({
        id: skippedRunId,
        type: 'instagram',
        state: 'completed',
        sourceId,
        output: {sourceId, jobIds: [], skipped: true},
      }),
      importRun({
        id: instagramRunId,
        type: 'instagram',
        state: 'completed',
        sourceId,
        output: {sourceId, jobIds: [googleRunId], skipped: false},
      }),
      importRun({
        id: googleRunId,
        type: 'gmaps',
        state: 'completed',
        sourceId,
        output: {placeIds: [importedPlaceId]},
      }),
    ];
    const limit = vi.fn().mockResolvedValue(runs);
    const orderBy = vi.fn(() => ({limit}));
    const where = vi.fn().mockResolvedValue([{sourceId, placeId: savedPlaceId}]);
    const from = vi.fn().mockReturnValueOnce({orderBy}).mockReturnValueOnce({where});
    const db = {select: vi.fn(() => ({from}))};

    const statuses = await listImportStatuses({
      db,
    } as unknown as Pick<Context, 'db'>);

    expect(db.select).toHaveBeenCalledTimes(2);
    expect(limit).toHaveBeenCalledExactlyOnceWith(50);
    expect(statuses).toMatchObject([
      {
        jobId: skippedRunId,
        state: 'completed',
        placeIds: [savedPlaceId, importedPlaceId],
      },
      {
        jobId: instagramRunId,
        state: 'completed',
        placeIds: [savedPlaceId, importedPlaceId],
      },
      {
        jobId: googleRunId,
        state: 'completed',
        placeIds: [importedPlaceId],
      },
    ]);
  });
});

describe('getting an import run', () => {
  it('uses the batch resolver for one Instagram run', async () => {
    const parent = importRun({
      id: instagramRunId,
      type: 'instagram',
      state: 'completed',
      sourceId,
      output: {sourceId, jobIds: [googleRunId], skipped: false},
    });
    const child = importRun({
      id: googleRunId,
      type: 'gmaps',
      state: 'completed',
      sourceId,
      output: {placeIds: [importedPlaceId]},
    });
    const rootWhere = vi.fn().mockResolvedValue([parent]);
    const childrenWhere = vi.fn().mockResolvedValue([child]);
    const savedWhere = vi.fn().mockResolvedValue([{sourceId, placeId: savedPlaceId}]);
    const from = vi
      .fn()
      .mockReturnValueOnce({where: rootWhere})
      .mockReturnValueOnce({where: childrenWhere})
      .mockReturnValueOnce({where: savedWhere});
    const db = {select: vi.fn(() => ({from}))};

    await expect(
      getImportStatus(instagramRunId, {
        db,
      } as unknown as Pick<Context, 'db'>),
    ).resolves.toMatchObject({
      jobId: instagramRunId,
      state: 'completed',
      placeIds: [savedPlaceId, importedPlaceId],
    });
    expect(db.select).toHaveBeenCalledTimes(3);
  });
});
