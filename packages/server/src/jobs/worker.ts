import type {JobWithMetadata, PgBoss} from 'pg-boss';

import type {WorkerQueueConfig} from '../config.ts';

export function registerWorker(
  boss: PgBoss,
  queue: string,
  options: WorkerQueueConfig,
  handler: (data: unknown, job: JobWithMetadata<unknown>) => Promise<unknown>,
) {
  return boss.work(
    queue,
    {
      batchSize: options.batchSize,
      localConcurrency: options.concurrency,
      perJobResults: true,
      includeMetadata: true,
    },
    jobs =>
      Promise.all(
        jobs.map(async job => {
          try {
            const output = await handler(job.data, job);

            return {
              id: job.id,
              status: 'completed' as const,
              output,
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Job failed.';

            return {
              id: job.id,
              status: 'failed' as const,
              output: {
                message,
              },
            };
          }
        }),
      ),
  );
}
