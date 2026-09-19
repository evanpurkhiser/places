import {tool, type RunItem} from '@openai/agents';
import {googleSearchQuery} from '@places/common/contract/place';
import {z} from 'zod';

import {type GooglePlaces, searchDetails} from '../google/index.ts';

/**
 * Expose Google search to the agent, propagating failures to the runner.
 */
export function createCaptureTools(google: Pick<GooglePlaces, 'search'>) {
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

  return [searchPlaces];
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
