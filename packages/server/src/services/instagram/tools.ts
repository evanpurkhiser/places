import {tool, type RunItem, type ToolCallOutputContent} from '@openai/agents';
import {googleSearchQuery} from '@places/common/contract/place';
import {z} from 'zod';

import {type GooglePlaces, searchDetails} from '../google/index.ts';

import type {InstagramMedia} from './media.ts';

/**
 * Expose Google search to the agent, propagating failures to the runner.
 */
export function createCaptureTools(
  google: Pick<GooglePlaces, 'search'>,
  media: InstagramMedia,
) {
  const searchPlaces = tool({
    name: 'searchPlaces',
    description:
      'Search Google Maps for candidate places. Include location clues and compare several results.',
    parameters: z.strictObject({
      query: googleSearchQuery,
      limit: z.number().int().min(1).max(10),
    }),
    errorFunction: null,
    execute: ({query, limit}) => google.search(query, limit),
  });

  if (media.kind === 'carousel') {
    return [searchPlaces];
  }

  const getVideoFrames = tool({
    name: 'getVideoFrames',
    description:
      'Inspect video frames when visual evidence would help identify places. Timestamps are seconds from the start of the video.',
    parameters: z.strictObject({
      timestamps: z
        .array(z.number().nonnegative().lt(media.durationSeconds))
        .min(1)
        .max(6),
    }),
    errorFunction: null,
    execute: async (
      {timestamps},
      _context,
      details,
    ): Promise<ToolCallOutputContent[]> => {
      const frames = await media.getFrames(timestamps, details?.signal);
      return frames.flatMap(frame => [
        {type: 'text', text: `Video frame at ${frame.timestampSeconds}s`},
        {type: 'image', image: frame.url, detail: 'auto'},
      ]);
    },
  });

  return [searchPlaces, getVideoFrames];
}

/**
 * Recover validated Google candidates from executed searches, skipping tool errors.
 */
export function collectSearchResults(items: RunItem[]) {
  const places = items.flatMap(item => {
    if (
      item.type !== 'tool_call_output_item' ||
      item.executionStatus !== 'executed' ||
      item.rawItem.type !== 'function_call_result' ||
      item.rawItem.name !== 'searchPlaces'
    ) {
      return [];
    }

    return z.array(searchDetails).parse(item.output);
  });

  return new Map(places.map(place => [place.id, place]));
}
