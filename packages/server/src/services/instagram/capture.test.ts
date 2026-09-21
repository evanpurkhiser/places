import OpenAI from 'openai';
import type {ResponseCreateParamsNonStreaming} from 'openai/resources/responses/responses';
import {describe, expect, it, vi} from 'vitest';

import {capture} from './capture.ts';
import rawFixture from './fixtures/cafe.json' with {type: 'json'};
import type {InstagramVideo} from './media.ts';
import {buildCapturePrompt} from './prompt.ts';
import type {CaptureContent} from './schema.ts';
import {captureContent, captureOptions} from './schema.ts';

const fixture = {...rawFixture, content: captureContent.parse(rawFixture.content)};

/**
 * Represent a model-requested tool call in the fake Responses transport.
 */
const call = (
  name = 'searchPlaces',
  args: unknown = {query: 'Example Cafe NYC', limit: 5},
  id = 'call_1',
) => ({
  type: 'function_call',
  name,
  arguments: JSON.stringify(args),
  call_id: id,
  id: `fc_${id}`,
  status: 'completed',
});

/**
 * Represent a structured final answer returned by the model.
 */
const final = (result: unknown = fixture.output) => ({
  type: 'message',
  id: 'msg_1',
  role: 'assistant',
  status: 'completed',
  content: [
    {
      type: 'output_text',
      text: JSON.stringify({
        description: fixture.output.description,
        ...(result as object),
      }),
      annotations: [],
    },
  ],
});

/**
 * Wrap scripted model output in a Responses API envelope.
 */
const response = (output: unknown[], status = 'completed') => ({
  id: 'resp_test',
  object: 'response',
  status,
  output,
});

/**
 * Exercise the real SDK runner with scripted HTTP responses and a fake Google service.
 */
function harness(outputs = [response([call()]), response([final()])]) {
  const requests: ResponseCreateParamsNonStreaming[] = [];
  const fetcher = vi.fn<typeof fetch>((_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const next = outputs.shift();

    if (!next) {
      throw new Error('Unexpected model request');
    }

    return Promise.resolve(Response.json(next));
  });
  const openai = new OpenAI({apiKey: 'fixture-key', fetch: fetcher, maxRetries: 0});
  const google = {
    search: vi.fn().mockResolvedValue(fixture.candidates),
  };

  const getFrames = vi.fn<InstagramVideo['getFrames']>();
  /**
   * Run capture with fixture defaults and per-test overrides.
   */
  const run = (
    options = {},
    content: CaptureContent = fixture.content,
    catalog = fixture.catalog,
    signal?: AbortSignal,
  ) =>
    capture(
      {openai, google},
      {
        ...fixture.metadata,
        caption: content.caption,
        location: content.location,
        [Symbol.asyncDispose]: async () => {},
        media: content.media.map(item =>
          item.kind === 'video'
            ? {...item, getFrames, [Symbol.asyncDispose]: async () => {}}
            : item,
        ),
      },
      catalog,
      {...fixture.options, ...options},
      signal,
    );

  return {run, google, requests, fetcher, getFrames, openai};
}

describe('Instagram capture', () => {
  it('returns scraped source metadata with the generated post summary', async () => {
    const {run} = harness();
    const result = await run();

    expect(result.source).toEqual({
      ...fixture.metadata,
      caption: fixture.content.caption,
      description: fixture.output.description,
    });
    expect(result.places[0]!.description).toBe(fixture.output.places[0]!.description);
  });

  it('requires a nonempty post summary', async () => {
    const {run} = harness([
      response([final({description: '', places: [], unresolved: []})]),
    ]);

    await expect(run()).rejects.toMatchObject({code: 'invalid_output'});
  });

  it('feeds candidates back and resolves selected tags and authoritative place metadata', async () => {
    const {run, google, requests} = harness();
    const result = await run();

    expect(google.search).toHaveBeenCalledExactlyOnceWith('Example Cafe NYC', 5);
    expect(result.metadata).toMatchObject({
      version: 1,
      model: 'o4-mini',
      prompt: expect.any(String),
      searches: [{query: 'Example Cafe NYC', limit: 5, candidates: fixture.candidates}],
      usage: {requests: expect.any(Number)},
    });
    expect(result.places[0]).toMatchObject({
      googlePlaceId: 'ChIJorchard',
      name: 'Example Cafe',
      formattedAddress: fixture.candidates[1]!.formattedAddress,
      tagIds: [fixture.catalog.tags[0]!.id, fixture.catalog.tags[2]!.id],
      evidence: fixture.output.places[0]!.evidence,
    });
    expect(requests[1]!.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_1',
          output: JSON.stringify(fixture.candidates),
        }),
      ]),
    );
    const format = JSON.stringify(requests[0]!.text?.format);
    expect(requests[0]!.tools).toHaveLength(2);
    expect(requests[0]!.tools![0]).toMatchObject({name: 'searchPlaces'});
    expect(format).toContain('type:cafe');
    expect(format).not.toContain('rating:favorite');
    expect(format).not.toContain('needs-review');
    expect(requests[0]).toMatchObject({
      store: false,
      parallel_tool_calls: true,
      model: 'o4-mini',
    });
  });

  it('starts videos with timestamps and retrieves images only through the frame tool', async () => {
    const {run, requests, getFrames} = harness([
      response([
        call('getVideoFrames', {videoId: 'media-1', timestamps: [2, 5]}, 'frames'),
      ]),
      response([call()]),
      response([final()]),
    ]);
    getFrames.mockResolvedValue([
      {url: 'data:image/jpeg;base64,YQ==', timestampSeconds: 2},
      {url: 'data:image/jpeg;base64,Yg==', timestampSeconds: 5},
    ]);

    await run();
    expect(getFrames).toHaveBeenCalledWith([2, 5], expect.any(AbortSignal));
    expect(JSON.stringify(requests[0]!.input)).not.toContain('input_image');
    expect(JSON.stringify(requests[0]!.input)).toContain('durationSeconds');
    const result = (requests[1]!.input as Array<{type: string; output?: unknown}>).find(
      item => item.type === 'function_call_output',
    );
    expect(result?.output).toEqual([
      {type: 'input_text', text: 'Video media-1 frame at 2s'},
      {type: 'input_image', image_url: 'data:image/jpeg;base64,YQ==', detail: 'auto'},
      {type: 'input_text', text: 'Video media-1 frame at 5s'},
      {type: 'input_image', image_url: 'data:image/jpeg;base64,Yg==', detail: 'auto'},
    ]);
  });

  it('routes concurrent frame requests by video ID and preserves mixed input order', async () => {
    const {openai, google, requests} = harness([
      response([
        call('getVideoFrames', {videoId: 'media-1', timestamps: [2]}, 'first'),
        call('getVideoFrames', {videoId: 'media-3', timestamps: [2]}, 'second'),
      ]),
      response([final({places: [], unresolved: []})]),
    ]);
    const first = vi
      .fn()
      .mockResolvedValue([{url: 'data:image/jpeg;base64,YQ==', timestampSeconds: 2}]);
    const second = vi
      .fn()
      .mockResolvedValue([{url: 'data:image/jpeg;base64,Yg==', timestampSeconds: 2}]);
    const video = {
      kind: 'video' as const,
      durationSeconds: 10,
      [Symbol.asyncDispose]: async () => {},
    };
    await capture(
      {openai, google},
      {
        ...fixture.metadata,
        caption: 'Mixed post',
        media: [
          {
            ...video,
            id: 'media-1',
            transcript: [{start: 0, end: 3, text: 'First cafe'}],
            getFrames: first,
          },
          {kind: 'image', id: 'media-2', image: 'data:image/jpeg;base64,Yw=='},
          {
            ...video,
            id: 'media-3',
            transcript: [{start: 0, end: 3, text: 'Second cafe'}],
            getFrames: second,
          },
        ],
        [Symbol.asyncDispose]: async () => {},
      },
      fixture.catalog,
      fixture.options,
    );
    expect(first).toHaveBeenCalledWith([2], expect.any(AbortSignal));
    expect(second).toHaveBeenCalledWith([2], expect.any(AbortSignal));
    const content = (
      requests[0]!.input as Array<{content: Array<{type: string; text?: string}>}>
    )[0]!.content;
    expect(content.map(item => item.type)).toEqual([
      'input_text',
      'input_text',
      'input_text',
      'input_image',
      'input_text',
    ]);
    expect(JSON.parse(content[1]!.text!)).toMatchObject({
      id: 'media-1',
      transcript: [{text: 'First cafe'}],
    });
    expect(content[2]!.text).toBe('Image media-2');
    expect(JSON.parse(content[4]!.text!)).toMatchObject({
      id: 'media-3',
      transcript: [{text: 'Second cafe'}],
    });
    const outputs = (
      requests[1]!.input as Array<{type: string; output?: unknown}>
    ).filter(item => item.type === 'function_call_output');
    expect(outputs.map(item => item.output)).toEqual([
      [
        {type: 'input_text', text: 'Video media-1 frame at 2s'},
        {type: 'input_image', image_url: 'data:image/jpeg;base64,YQ==', detail: 'auto'},
      ],
      [
        {type: 'input_text', text: 'Video media-3 frame at 2s'},
        {type: 'input_image', image_url: 'data:image/jpeg;base64,Yg==', detail: 'auto'},
      ],
    ]);
    expect(JSON.stringify(requests[0]!.tools)).toContain('media-3');
  });

  it('checks timestamps against the selected video duration', async () => {
    const {run, getFrames} = harness([
      response([call('getVideoFrames', {videoId: 'media-1', timestamps: [60]})]),
    ]);
    await expect(run()).rejects.toMatchObject({code: 'invalid_output'});
    expect(getFrames).not.toHaveBeenCalled();
  });

  it('groups assignable tags and omits excluded tags and empty groups', () => {
    const prompt = buildCapturePrompt(
      fixture.catalog,
      captureOptions.parse(fixture.options),
    );

    expect(prompt).toContain(
      '## type — What kind of place this is\n  - type:cafe — Coffee shops and cafes\n  - type:restaurant',
    );
    expect(prompt).not.toContain('rating:favorite');
    expect(prompt).not.toContain('needs-review');
    expect(prompt).not.toContain('## rating');
    expect(prompt).not.toContain('## Ungrouped');
    expect(prompt).toContain(fixture.options.instructions);
  });

  it.each(['excludedNamespaces', 'excludedTags', 'requiredNamespaces'])(
    'requires explicit %s configuration before making a request',
    async name => {
      const {run, fetcher} = harness();
      await expect(run({[name]: undefined})).rejects.toMatchObject({name: 'ZodError'});
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('passes an explicitly configured reasoning effort to the model', async () => {
    const {run, requests} = harness();
    await run({reasoningEffort: 'medium'});

    expect(requests[0]!.reasoning).toEqual({effort: 'medium'});
  });

  it('supports refined searches while replaying reasoning state', async () => {
    const reasoning = {
      type: 'reasoning',
      id: 'rs_1',
      summary: [],
      encrypted_content: 'opaque-reasoning',
    };
    const {run, requests, google} = harness([
      response([reasoning, call()]),
      response([
        call(
          'searchPlaces',
          {query: 'Example Cafe Orchard Street Manhattan', limit: 3},
          'call_2',
        ),
      ]),
      response([final()]),
    ]);
    google.search.mockResolvedValueOnce([]);

    await run();
    expect(google.search).toHaveBeenCalledTimes(2);
    expect(requests[2]!.input).toEqual(
      expect.arrayContaining([
        reasoning,
        expect.objectContaining({
          type: 'function_call_output',
          call_id: 'call_2',
          output: JSON.stringify(fixture.candidates),
        }),
      ]),
    );
  });

  it('resolves selections from earlier searches in the completed run', async () => {
    const {run, google} = harness([
      response([call()]),
      response([call('searchPlaces', {query: 'Another cafe', limit: 3}, 'call_2')]),
      response([final()]),
    ]);
    google.search
      .mockResolvedValueOnce([fixture.candidates[1]!])
      .mockResolvedValueOnce([fixture.candidates[0]!]);

    const result = await run();
    expect(result.places[0]).toMatchObject({
      googlePlaceId: fixture.candidates[1]!.id,
      formattedAddress: fixture.candidates[1]!.formattedAddress,
    });
  });

  it('resolves places from parallel searches in one turn', async () => {
    const item = fixture.output.places[0]!;
    const {run, google, requests} = harness([
      response([
        call('searchPlaces', {query: 'Cafe Manhattan', limit: 3}, 'call_1'),
        call('searchPlaces', {query: 'Cafe Brooklyn', limit: 3}, 'call_2'),
      ]),
      response([
        final({
          places: [item, {...item, googlePlaceId: fixture.candidates[0]!.id}],
          unresolved: [],
        }),
      ]),
    ]);
    google.search
      .mockResolvedValueOnce([fixture.candidates[1]!])
      .mockResolvedValueOnce([fixture.candidates[0]!]);

    const result = await run();
    expect(result.places.map(place => place.googlePlaceId)).toEqual([
      fixture.candidates[1]!.id,
      fixture.candidates[0]!.id,
    ]);
    expect(result.metadata.searches).toEqual([
      {query: 'Cafe Manhattan', limit: 3, candidates: [fixture.candidates[1]!]},
      {query: 'Cafe Brooklyn', limit: 3, candidates: [fixture.candidates[0]!]},
    ]);
    expect(google.search).toHaveBeenCalledTimes(2);
    expect(requests[1]!.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({type: 'function_call_output', call_id: 'call_1'}),
        expect.objectContaining({type: 'function_call_output', call_id: 'call_2'}),
      ]),
    );
  });

  it('supports multiple places and collapses repeated tag assignments', async () => {
    const item = fixture.output.places[0]!;
    const {run} = harness([
      response([call()]),
      response([
        final({
          places: [
            {...item, tags: ['type:cafe', 'type:cafe']},
            {...item, googlePlaceId: 'ChIJwrongBranch'},
          ],
          unresolved: [],
        }),
      ]),
    ]);

    const result = await run();
    expect(result.places).toHaveLength(2);
    expect(result.places[0]!.tagIds).toEqual([fixture.catalog.tags[0]!.id]);
  });

  it.each([
    {places: [], unresolved: []},
    {
      places: [],
      unresolved: [{name: 'Example Cafe', reason: 'The branch is ambiguous.'}],
    },
  ])('preserves empty and unresolved outcomes', async result => {
    const {run} = harness([response([final(result)])]);
    expect(await run()).toMatchObject(result);
  });

  it.each([
    {googlePlaceId: 'invented'},
    {tags: ['rating:favorite']},
    {tags: ['needs-review']},
    {tags: ['type:invented']},
    {tags: ['vibe:casual']},
  ])('rejects ungrounded output or invalid tagging: %j', async change => {
    const output = {
      ...fixture.output,
      places: [{...fixture.output.places[0], ...change}],
    };
    const {run} = harness([response([call()]), response([final(output)])]);
    await expect(run()).rejects.toMatchObject({code: 'invalid_output'});
  });

  it('rejects duplicate place IDs', async () => {
    const {run} = harness([
      response([call()]),
      response([
        final({
          places: [fixture.output.places[0], fixture.output.places[0]],
          unresolved: [],
        }),
      ]),
    ]);
    await expect(run()).rejects.toMatchObject({code: 'invalid_output'});
  });

  it.each([
    call('writePlace'),
    call('searchPlaces', {query: '', limit: 5}),
    call('searchPlaces', {query: 'NYC', limit: 100}),
  ])('rejects invalid tool calls before reaching Google: %j', async toolCall => {
    const {run, google} = harness([response([toolCall])]);
    await expect(run()).rejects.toMatchObject({code: 'invalid_output'});
    expect(google.search).not.toHaveBeenCalled();
  });

  it('lets the SDK report malformed tool JSON back to the model', async () => {
    const {run, google, requests} = harness([
      response([{...call(), arguments: '{'}]),
      response([final({places: [], unresolved: []})]),
    ]);
    expect(await run()).toMatchObject({places: [], unresolved: []});
    expect(google.search).not.toHaveBeenCalled();
    expect(requests[1]!.input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({type: 'function_call_output', call_id: 'call_1'}),
      ]),
    );
  });

  it('bounds repeated searches with the SDK turn limit', async () => {
    const {run, google, fetcher} = harness([
      response([call()]),
      response([call('searchPlaces', {query: 'Cafe Manhattan', limit: 3}, 'call_2')]),
    ]);
    await expect(run({maxTurns: 2})).rejects.toMatchObject({code: 'turn_limit'});
    expect(google.search).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('distinguishes refusals from empty captures', async () => {
    const {run} = harness([
      response([{...final(), content: [{type: 'refusal', refusal: 'No'}]}]),
    ]);
    await expect(run()).rejects.toMatchObject({code: 'refused'});
  });

  it('rejects malformed model JSON', async () => {
    const {run} = harness([
      response([
        {...final(), content: [{type: 'output_text', text: '{', annotations: []}]},
      ]),
    ]);
    await expect(run()).rejects.toMatchObject({code: 'invalid_output'});
  });

  it('sanitizes provider failures', async () => {
    const model = harness();
    model.fetcher.mockRejectedValue(new Error('secret-key and private content'));
    await expect(model.run()).rejects.toMatchObject({
      code: 'provider_unavailable',
      message: 'A capture provider is unavailable.',
    });
    const google = harness();
    google.google.search.mockRejectedValue(new Error('secret-key and private content'));
    await expect(google.run()).rejects.toMatchObject({
      code: 'provider_unavailable',
      message: 'A capture provider is unavailable.',
    });
  });

  it('validates impossible required groups before making a request', async () => {
    const {run, fetcher} = harness();
    await expect(run({requiredNamespaces: ['rating']})).rejects.toMatchObject({
      code: 'invalid_configuration',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('supports an empty catalog without allowing invented tags', async () => {
    const item = {...fixture.output.places[0], tags: []};
    const {run} = harness([
      response([call()]),
      response([final({places: [item], unresolved: []})]),
    ]);
    const result = await run({requiredNamespaces: []}, fixture.content, {
      tags: [],
      namespaces: [],
    });
    expect(result.places[0]!.tagIds).toEqual([]);
    const invalid = harness();
    await expect(
      invalid.run({requiredNamespaces: []}, fixture.content, {tags: [], namespaces: []}),
    ).rejects.toMatchObject({code: 'invalid_output'});
  });

  it('rejects a required group missing from the catalog', async () => {
    const {run, fetcher} = harness();
    await expect(
      run({}, fixture.content, {...fixture.catalog, namespaces: []}),
    ).rejects.toMatchObject({code: 'invalid_configuration'});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('passes identified images to the model', async () => {
    const {run, requests} = harness([response([final({places: [], unresolved: []})])]);
    await run(
      {},
      {
        ...fixture.content,
        media: [{kind: 'image', id: 'media-1', image: 'data:image/jpeg;base64,YQ=='}],
      },
    );
    expect(requests[0]!.tools).toHaveLength(1);
    expect(requests[0]!.input).toEqual([
      expect.objectContaining({
        content: expect.arrayContaining([
          {type: 'input_text', text: 'Image media-1'},
          {type: 'input_image', image_url: 'data:image/jpeg;base64,YQ==', detail: 'auto'},
        ]),
      }),
    ]);
  });

  it('honors caller cancellation before sending content', async () => {
    const {run, fetcher} = harness();
    await expect(
      run({}, fixture.content, fixture.catalog, AbortSignal.abort()),
    ).rejects.toMatchObject({name: 'AbortError'});
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stops after an in-flight Google request when cancelled', async () => {
    const controller = new AbortController();
    const {run, google, fetcher} = harness();
    google.search.mockImplementation(() => {
      controller.abort();
      return Promise.resolve(fixture.candidates);
    });

    await expect(
      run({}, fixture.content, fixture.catalog, controller.signal),
    ).rejects.toMatchObject({name: 'AbortError'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('bounds a stalled model request by the capture timeout', async () => {
    const {run, fetcher} = harness();
    fetcher.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = init!.signal!;
          signal.addEventListener('abort', () => reject(signal.reason), {once: true});
        }),
    );

    await expect(run({timeoutMs: 20})).rejects.toMatchObject({name: 'TimeoutError'});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
