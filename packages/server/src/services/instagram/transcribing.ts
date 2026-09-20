import type OpenAI from 'openai';
import {z} from 'zod';

export const transcriptSegments = z.array(
  z
    .object({
      start: z.number().nonnegative().finite(),
      end: z.number().nonnegative().finite(),
      text: z.string(),
    })
    .refine(segment => segment.end >= segment.start),
);

export type TranscriptSegment = z.infer<typeof transcriptSegments>[number];

/**
 * Transcribe extracted audio with segment timestamps for targeted frame requests.
 */
export function createTranscriber(openai: OpenAI) {
  return async (audio: Buffer, signal?: AbortSignal) => {
    const result = await openai.audio.transcriptions.create(
      {
        file: new File([new Uint8Array(audio)], 'audio.mp3', {type: 'audio/mpeg'}),
        model: 'whisper-1',
        response_format: 'verbose_json',
        timestamp_granularities: ['segment'],
      },
      {signal},
    );

    if (!result.segments) {
      throw new Error('Transcription did not include timestamped segments.');
    }

    return transcriptSegments.parse(result.segments);
  };
}
