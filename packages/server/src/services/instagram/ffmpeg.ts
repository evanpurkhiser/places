import {z} from 'zod';

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const exec = promisify(execFile);
const probeOutput = z.object({
  format: z.object({duration: z.coerce.number().positive().finite()}),
  streams: z.array(z.object({codec_type: z.string()})),
});

export interface FFmpeg {
  probe(
    path: string,
    signal?: AbortSignal,
  ): Promise<{durationSeconds: number; hasAudio: boolean}>;
  audio(input: string, signal?: AbortSignal): Promise<Buffer>;
  image(input: string, timestampSeconds: number, signal?: AbortSignal): Promise<Buffer>;
}

/**
 * Wrap local media processing with configurable binaries and bounded subprocesses.
 */
export function createFFmpeg(
  options: {ffmpegPath?: string; ffprobePath?: string} = {},
): FFmpeg {
  const ffmpeg = options.ffmpegPath ?? 'ffmpeg';
  const ffprobe = options.ffprobePath ?? 'ffprobe';

  /**
   * Run a media command without a shell and terminate it on timeout or cancellation.
   */
  function run(binary: string, args: string[], signal?: AbortSignal) {
    return exec(binary, args, {
      signal,
      timeout: 60000,
      encoding: 'buffer',
      maxBuffer: Infinity,
      killSignal: 'SIGKILL',
    });
  }

  return {
    /**
     * Read video duration and audio availability before choosing preparation steps.
     */
    async probe(path, signal) {
      const {stdout} = await run(
        ffprobe,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration:stream=codec_type',
          '-of',
          'json',
          path,
        ],
        signal,
      );
      const result = probeOutput.parse(JSON.parse(stdout.toString()));

      if (!result.streams.some(stream => stream.codec_type === 'video')) {
        throw new Error('Media contains no video stream.');
      }

      return {
        durationSeconds: result.format.duration,
        hasAudio: result.streams.some(stream => stream.codec_type === 'audio'),
      };
    },
    /**
     * Extract mono audio suitable for timestamped transcription.
     */
    async audio(input, signal) {
      const {stdout} = await run(
        ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-i',
          input,
          '-map',
          '0:a:0',
          '-vn',
          '-ac',
          '1',
          '-ar',
          '16000',
          '-b:a',
          '64k',
          '-f',
          'mp3',
          'pipe:1',
        ],
        signal,
      );
      return stdout;
    },
    /**
     * Extract a JPEG video frame at its original dimensions.
     */
    async image(input, timestampSeconds, signal) {
      const {stdout} = await run(
        ffmpeg,
        [
          '-nostdin',
          '-v',
          'error',
          '-i',
          input,
          '-ss',
          String(timestampSeconds),
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-q:v',
          '3',
          '-f',
          'image2pipe',
          '-c:v',
          'mjpeg',
          'pipe:1',
        ],
        signal,
      );
      return stdout;
    },
  };
}
