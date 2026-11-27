import type {Database} from '../db/index.ts';
import {auditEntries} from '../db/schema.ts';

import {auditEntry, type AuditEntry} from './schema.ts';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export async function saveAuditEntry(tx: Transaction, entry: AuditEntry): Promise<void> {
  await tx.insert(auditEntries).values(auditEntry.parse(entry));
}
