import OpenAI from 'openai';
import {describe, expect, it, vi} from 'vitest';

import {createTranscriber} from './transcribing.ts';

describe('Instagram transcription', () => {
  it('requests timestamped transcription through the real SDK transport', async () => {
    const audio = Buffer.from('audio');
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const form = await new Response(init!.body as BodyInit, {
        headers: init!.headers,
      }).formData();
      expect(form.get('model')).toBe('whisper-1');
      expect(form.get('response_format')).toBe('verbose_json');
      expect(form.get('timestamp_granularities[]')).toBe('segment');
      const file = form.get('file') as File;
      expect(file.name).toBe('audio.mp3');
      expect(file.type).toBe('audio/mpeg');
      expect(await file.text()).toBe('audio');
      return Response.json({segments: [{start: 1, end: 2, text: 'Cafe', tokens: [1]}]});
    });
    const openai = new OpenAI({apiKey: 'fixture-key', fetch: fetcher, maxRetries: 0});
    expect(await createTranscriber(openai)(audio)).toEqual([
      {start: 1, end: 2, text: 'Cafe'},
    ]);
  });

  it('treats missing transcript timestamps as a preparation failure', async () => {
    const audio = Buffer.from('audio');
    const openai = new OpenAI({
      apiKey: 'fixture-key',
      maxRetries: 0,
      fetch: () => Promise.resolve(Response.json({text: 'Cafe'})),
    });
    await expect(createTranscriber(openai)(audio)).rejects.toThrow(
      'timestamped segments',
    );
  });
});
