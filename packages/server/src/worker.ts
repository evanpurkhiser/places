import {loadConfig} from './config.ts';
import {createDatabase} from './db/index.ts';
import {importQueue, registerImportWorker} from './jobs/gmaps-import.ts';
import {registerSyncWorker, syncQueue} from './jobs/gmaps-sync.ts';
import {startJobs} from './jobs/index.ts';
import {createGooglePlaces} from './services/google/index.ts';

const config = await loadConfig();

if (!config.google.apiKey) {
  throw new Error('Configure google.apiKey to run the worker.');
}

const db = createDatabase(config.database.url);
const jobs = await startJobs(config.database.url);

const google = createGooglePlaces(config.google.apiKey);

await registerImportWorker(jobs, db, google, config.workers[importQueue]);
await registerSyncWorker(jobs, db, google, config.workers[syncQueue]);
console.log('Places import and sync worker started.');

async function shutdown() {
  await jobs.stop();
  await db.$client.end();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
