import {InvalidValueError} from '@places/common/filter-engine';
import {eq} from 'drizzle-orm';

import type {Database} from '../db/index.ts';
import {tags} from '../db/schema.ts';
import {GoogleInputError} from '../services/google/errors.ts';
import {
  createGooglePlaces,
  isGoogleMapsInput,
  type GooglePlaces,
} from '../services/google/index.ts';

export type Point = {longitude: number; latitude: number};

export interface Context {
  google: GooglePlaces;
  tagExists(name: string): Promise<boolean>;
  resolvePoint(name: string): Promise<Point>;
}

export function createContext(
  db: Database,
  google: GooglePlaces = createGooglePlaces(),
): Context {
  const lookups = new Map<string, Promise<boolean>>();
  const points = new Map<string, Promise<Point>>();

  async function lookupPoint(name: string): Promise<Point> {
    try {
      if (isGoogleMapsInput(name)) {
        const place = await google.get(await google.resolve(name));

        return place.location;
      }

      const [match] = await google.search(name);

      if (!match) {
        throw new InvalidValueError(`No place found for "${name}".`);
      }

      return match.location;
    } catch (error) {
      if (error instanceof GoogleInputError) {
        throw new InvalidValueError(error.message);
      }

      throw error;
    }
  }

  const context: Context = {
    google,
    resolvePoint(name) {
      const existing = points.get(name);

      if (existing) {
        return existing;
      }

      const lookup = lookupPoint(name);
      points.set(name, lookup);
      return lookup;
    },
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
