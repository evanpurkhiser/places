import OpenAI from 'openai';

import {loadConfig} from './config.ts';
import {createDatabase} from './db/index.ts';
import {registerImportWorker} from './jobs/gmaps-import.ts';
import {registerSyncWorker} from './jobs/gmaps-sync.ts';
import {startJobs} from './jobs/index.ts';
import {registerInstagramImportWorker} from './jobs/instagram-import.ts';
import {createGooglePlaces} from './services/google/index.ts';
import {createFFmpeg} from './services/instagram/index.ts';

const config = await loadConfig();

if (!config.google.apiKey) {
  throw new Error('Configure google.apiKey to run the worker.');
}

const db = createDatabase(config.database.url);
const jobs = await startJobs(config.database.url);

const google = createGooglePlaces(config.google.apiKey);

await registerImportWorker(jobs, {db, google}, config.workers['gmaps-import']);
await registerSyncWorker(jobs, {db, google}, config.workers['gmaps-sync']);

const openai = new OpenAI({apiKey: config.openai.key});
const ffmpeg = createFFmpeg();

await registerInstagramImportWorker(
  jobs,
  {db, google, openai, ffmpeg, config: config.instagram},
  config.workers['instagram-import'],
);

console.log('Places workers started.');

async function shutdown() {
  await jobs.stop();
  await db.$client.end();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
