import {eq} from 'drizzle-orm';

import type {Database} from '../db/index.ts';
import {sources} from '../db/schema.ts';

// Serialize repeat Instagram imports with the jobs that attach their places.
export async function lockImportSource(db: Pick<Database, 'select'>, sourceId: string) {
  await db
    .select({id: sources.id})
    .from(sources)
    .where(eq(sources.id, sourceId))
    .for('no key update');
}
