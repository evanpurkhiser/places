import {eq} from 'drizzle-orm';

import type {Database} from '../db/index.ts';
import {tags} from '../db/schema.ts';

export interface Context {
  tagExists(name: string): Promise<boolean>;
}

export function createContext(db: Database): Context {
  const lookups = new Map<string, Promise<boolean>>();
  const context: Context = {
    tagExists(name) {
      const existing = lookups.get(name);

      if (existing) {
        return existing;
      }

      const lookup = db
        .select({id: tags.id})
        .from(tags)
        .where(eq(tags.name, name))
        .limit(1)
        .then(rows => rows.length > 0);

      lookups.set(name, lookup);
      return lookup;
    },
  };
  return context;
}
