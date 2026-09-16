import {loadConfig} from './config.ts';
import {createDatabase} from './db/index.ts';
import {registerImportWorker} from './jobs/gmaps-import.ts';
import {startJobs} from './jobs/index.ts';
import {createGooglePlaces} from './services/google/index.ts';

const config = await loadConfig();

if (!config.google.apiKey) {
  throw new Error('Configure google.apiKey to run the import worker.');
}

const db = createDatabase(config.database.url);
const jobs = await startJobs(config.database.url);

await registerImportWorker(jobs, db, createGooglePlaces(config.google.apiKey));
console.log('Places import worker started.');

async function shutdown() {
  await jobs.stop();
  await db.$client.end();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
