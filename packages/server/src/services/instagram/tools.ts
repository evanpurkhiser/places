import {
  ModelBehaviorError,
  tool,
  type RunItem,
  type ToolCallOutputContent,
} from '@openai/agents';
import {googleSearchQuery} from '@places/common/contract/place';
import {z} from 'zod';

import {type GooglePlaces, searchDetails} from '../google/index.ts';

import type {InstagramPost} from './media.ts';

/**
 * Expose place search and frame inspection for the videos in this post.
 */
export function createCaptureTools(
  google: Pick<GooglePlaces, 'search'>,
  post: InstagramPost,
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

  const videos = post.media.filter(item => item.kind === 'video');

  if (videos.length === 0) {
    return [searchPlaces];
  }

  const getVideoFrames = tool({
    name: 'getVideoFrames',
    description:
      'Inspect video frames when visual evidence would help identify places. Select a video by its media ID. Timestamps are seconds from the start of that video.',
    parameters: z.strictObject({
      videoId: z.enum(videos.map(video => video.id)),
      timestamps: z.array(z.number().nonnegative()).min(1).max(6),
    }),
    errorFunction: null,
    execute: async (
      {videoId, timestamps},
      _context,
      details,
    ): Promise<ToolCallOutputContent[]> => {
      const video = videos.find(item => item.id === videoId)!;

      if (timestamps.some(timestamp => timestamp >= video.durationSeconds)) {
        throw new ModelBehaviorError(
          'Frame timestamps must be within the selected video.',
        );
      }

      const frames = await video.getFrames(timestamps, details?.signal);
      return frames.flatMap(frame => [
        {type: 'text', text: `Video ${videoId} frame at ${frame.timestampSeconds}s`},
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
