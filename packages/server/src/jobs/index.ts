import {PgBoss} from 'pg-boss';

import {importQueue, queueOptions} from './gmaps-import.ts';

export async function startJobs(connectionString: string) {
  const boss = new PgBoss({connectionString});

  boss.on('error', error => console.error('Job queue error', error));

  try {
    await boss.start();
    await boss.createQueue(importQueue, queueOptions);

    return boss;
  } catch (error) {
    await boss.stop();
    throw error;
  }
}
