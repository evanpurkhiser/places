import {ORPCError} from '@orpc/server';
import {type ImportTag, importResult} from '@places/common/contract/place';
import {inArray, or} from 'drizzle-orm';
import {z} from 'zod';

import {tags} from '../db/schema.ts';
import {importPayload, importQueue} from '../jobs/gmaps-import.ts';
import type {Context} from '../rpc/context.ts';
import {isGoogleMapsInput} from '../services/google/index.ts';

const importers = [
  {
    type: 'gmaps' as const,
    queue: importQueue,
    accepts: isGoogleMapsInput,
    prepare: async (input: string, context: Context) =>
      importPayload.parse({googlePlaceId: await context.google.resolve(input)}),
  },
];

function tagsByNameOrId(values: string[]) {
  const ids = values.filter(value => z.uuid().safeParse(value).success);

  return or(inArray(tags.id, ids), inArray(tags.name, values));
}

async function resolveTags(assignments: ImportTag[], {db}: Context) {
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

export async function enqueueImport(
  input: string,
  context: Context,
  tags: ImportTag[] = [],
  notes?: string,
) {
  const importer = importers.find(candidate => candidate.accepts(input));

  if (!importer) {
    throw new ORPCError('BAD_REQUEST', {
      message:
        'Unsupported import input. Currently supported: Google Maps place URLs and gmaps:<place_id>.',
    });
  }

  const resolvedTags = await resolveTags(tags, context);
  const payload = {
    ...(await importer.prepare(input, context)),
    tags: resolvedTags,
    notes,
  };
  const jobId = await context.jobs.send(importer.queue, payload);

  if (!jobId) {
    throw new ORPCError('SERVICE_UNAVAILABLE', {message: 'Could not queue the import.'});
  }

  return {jobId, type: importer.type};
}

export async function getImportStatus(jobId: string, {jobs}: Context) {
  for (const importer of importers) {
    const job = await jobs.getJobById(importer.queue, jobId);

    if (!job) {
      continue;
    }

    return {
      jobId: job.id,
      type: importer.type,
      state: job.state,
      placeIds: job.state === 'completed' ? importResult.parse(job.output).placeIds : [],
      error:
        job.state === 'failed' || job.state === 'retry'
          ? 'Import failed. Check the provider configuration and retry.'
          : null,
    };
  }

  throw new ORPCError('NOT_FOUND', {message: 'Import not found or expired.'});
}
