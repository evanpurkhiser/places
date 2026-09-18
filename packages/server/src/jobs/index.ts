import {PgBoss} from 'pg-boss';

import {importQueue, queueOptions} from './gmaps-import.ts';
import {syncQueue} from './gmaps-sync.ts';

export async function startJobs(connectionString: string) {
  const boss = new PgBoss({connectionString});

  boss.on('error', error => console.error('Job queue error', error));

  try {
    await boss.start();
    await boss.createQueue(importQueue, queueOptions);
    await boss.createQueue(syncQueue, {...queueOptions, policy: 'exclusive'});

    return boss;
  } catch (error) {
    await boss.stop();
    throw error;
  }
}
