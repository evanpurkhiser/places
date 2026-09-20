import {PgBoss} from 'pg-boss';

import {
  importQueue as googleImportQueue,
  queueOptions as googleImportOptions,
} from './gmaps-import.ts';
import {syncQueue as googleSyncQueue} from './gmaps-sync.ts';
import {
  importQueue as instagramImportQueue,
  queueOptions as instagramImportOptions,
} from './instagram-import.ts';

export async function startJobs(connectionString: string) {
  const boss = new PgBoss({connectionString});

  boss.on('error', error => console.error('Job queue error', error));

  try {
    await boss.start();
    await boss.createQueue(googleImportQueue, googleImportOptions);
    await boss.createQueue(instagramImportQueue, instagramImportOptions);
    await boss.createQueue(googleSyncQueue, {
      ...googleImportOptions,
      policy: 'exclusive',
    });

    return boss;
  } catch (error) {
    await boss.stop();
    throw error;
  }
}
