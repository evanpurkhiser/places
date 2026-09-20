import {ORPCError} from '@orpc/server';
import type {ImportTag} from '@places/common/contract/place';
import {inArray, or} from 'drizzle-orm';
import {z} from 'zod';

import {tags} from '../db/schema.ts';
import type {Context} from '../rpc/context.ts';

function tagsByNameOrId(values: string[]) {
  const ids = values.filter(value => z.uuid().safeParse(value).success);

  return or(inArray(tags.id, ids), inArray(tags.name, values));
}

export async function resolveTags(assignments: ImportTag[], {db}: Context) {
  if (assignments.length === 0) {
    return [];
  }

  const matches = await db
    .select({id: tags.id, name: tags.name})
    .from(tags)
    .where(tagsByNameOrId(assignments.map(({tag}) => tag)));
  const resolved = new Map<string, {tagId: string; note?: string}>();

  for (const {tag: value, note} of assignments) {
    const match =
      matches.find(tag => tag.id === value) ?? matches.find(tag => tag.name === value);

    if (!match) {
      throw new ORPCError('BAD_REQUEST', {message: `Tag not found: ${value}`});
    }

    // A bare assignment preserves any explicitly supplied note for the same tag.
    resolved.set(match.id, {
      tagId: match.id,
      note: note ?? resolved.get(match.id)?.note,
    });
  }

  return [...resolved.values()];
}
