import type {Config} from './config.ts';
import type {Database} from './db/index.ts';

export interface Context {
  config: Config;
  db: Database;
}
