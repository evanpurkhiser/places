import type {PgTable} from 'drizzle-orm/pg-core';

import type {Context} from '../context.ts';

export function createSelectContext(
  tables: ReadonlyArray<readonly [PgTable, readonly unknown[]]>,
) {
  const rowsByTable = new Map(tables);
  const db = {
    select: () => ({
      from: (table: PgTable) => {
        const rows = rowsByTable.get(table);
        if (!rows) {
          throw new Error('No test rows configured for this table.');
        }

        return {where: () => Promise.resolve(rows)};
      },
    }),
  };

  return {db} as unknown as Context;
}
