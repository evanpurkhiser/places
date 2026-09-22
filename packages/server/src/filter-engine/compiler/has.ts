import {InvalidValueError, type FilterCompilerFor} from '@places/common/filter-engine';
import type {has as hasDefinition} from '@places/common/filter-engine/filters/has';
import type {SQL} from 'drizzle-orm';

import type {Context} from '../context.ts';
export const hasCompiler = {
  compile: ({property}, context: Context, presence): SQL => {
    const compilePresence = presence.get(property.value);

    if (!compilePresence) {
      throw new InvalidValueError(`Presence is not supported for ${property.value}`);
    }

    return compilePresence(context);
  },
} satisfies FilterCompilerFor<typeof hasDefinition, SQL, Context>;
