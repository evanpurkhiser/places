import type {PgBoss} from 'pg-boss';

import type {Config} from './config.ts';
import type {Database} from './db/index.ts';
import type {GooglePlaces} from './services/google/index.ts';

export interface Context {
  config: Config;
  db: Database;
  jobs: PgBoss;
  google: GooglePlaces;
}
