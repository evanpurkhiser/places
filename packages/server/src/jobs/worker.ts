import type {PgBoss} from 'pg-boss';

import type {WorkerQueueConfig} from '../config.ts';

export function registerWorker(
  boss: PgBoss,
  queue: string,
  options: WorkerQueueConfig,
  handler: (data: unknown) => Promise<unknown>,
) {
  return boss.work(
    queue,
    {
      batchSize: options.batchSize,
      localConcurrency: options.concurrency,
      perJobResults: true,
    },
    jobs =>
      Promise.all(
        jobs.map(async job => {
          try {
            return {
              id: job.id,
              status: 'completed' as const,
              output: await handler(job.data),
            };
          } catch (error) {
            return {
              id: job.id,
              status: 'failed' as const,
              output: {
                message: error instanceof Error ? error.message : 'Job failed.',
              },
            };
          }
        }),
      ),
  );
}
