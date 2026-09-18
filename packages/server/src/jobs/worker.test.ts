import {Pool} from 'pg';
import {PgBoss} from 'pg-boss';
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest';
import {z} from 'zod';

import {randomUUID} from 'node:crypto';

import {registerWorker} from './worker.ts';

const testUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testUrl)('configured batch workers', () => {
  const databaseName = `places_workers_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({connectionString: testUrl});
  const url = new URL(testUrl ?? 'postgres://localhost/places');
  url.pathname = `/${databaseName}`;
  const boss = new PgBoss(url.href);

  beforeAll(async () => {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await boss.start();
    await boss.createQueue('batch-test', {retryLimit: 1, retryDelay: 0});
  }, 30000);

  afterAll(async () => {
    await boss.stop();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  });

  it('runs multiple batches concurrently and retries only failed members', async () => {
    const release = Promise.withResolvers<void>();
    const started = new Set<number>();
    const attempts = new Map<number, number>();
    let active = 0;
    let maximum = 0;
    const ids = await boss.insert(
      'batch-test',
      Array.from({length: 6}, (_, value) => ({data: {value}})),
      {returnId: true},
    );

    await registerWorker(
      boss,
      'batch-test',
      {batchSize: 2, concurrency: 2},
      async data => {
        const {value} = z.object({value: z.number()}).parse(data);
        const attempt = (attempts.get(value) ?? 0) + 1;
        attempts.set(value, attempt);
        started.add(value);
        active++;
        maximum = Math.max(maximum, active);

        try {
          await release.promise;

          if (value === 2 && attempt === 1) {
            throw new Error('Transient failure');
          }

          return {value};
        } finally {
          active--;
        }
      },
    );

    try {
      await vi.waitFor(() => expect(started.size).toBe(4), {timeout: 10000});
      expect(maximum).toBe(4);
    } finally {
      release.resolve();
    }

    await vi.waitFor(
      async () => {
        const jobs = await Promise.all(ids!.map(id => boss.getJobById('batch-test', id)));
        expect(jobs.every(job => job?.state === 'completed')).toBe(true);
        expect(
          jobs
            .map(job => z.object({value: z.number()}).parse(job!.output))
            .sort((a, b) => a.value - b.value),
        ).toEqual(Array.from({length: 6}, (_, value) => ({value})));
      },
      {timeout: 15000},
    );
    expect([...attempts.entries()].sort(([a], [b]) => a - b)).toEqual([
      [0, 1],
      [1, 1],
      [2, 2],
      [3, 1],
      [4, 1],
      [5, 1],
    ]);
    expect(maximum).toBe(4);
  }, 25000);
});
