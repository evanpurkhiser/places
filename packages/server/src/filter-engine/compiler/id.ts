import type {FilterCompilerFor} from '@places/common/filter-engine';
import type {id as idDefinition} from '@places/common/filter-engine/filters/id';
import {eq, type SQL} from 'drizzle-orm';

import {places} from '../../db/schema.ts';
import type {Context} from '../context.ts';

export const idCompiler = {
  compile: ({id}) => eq(places.id, id.value),
} satisfies FilterCompilerFor<typeof idDefinition, SQL, Context>;
