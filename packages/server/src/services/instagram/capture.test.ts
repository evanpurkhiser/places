import OpenAI from 'openai';
import type {ResponseCreateParamsNonStreaming} from 'openai/resources/responses/responses';
import {describe, expect, it, vi} from 'vitest';

import {capture} from './capture.ts';
import fixture from './fixtures/cafe.json' with {type: 'json'};
import type {InstagramMedia} from './media.ts';
import {buildCapturePrompt} from './prompt.ts';
import type {CaptureContent} from './schema.ts';
import {captureOptions} from './schema.ts';

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
  content: [{type: 'output_text', text: JSON.stringify(result), annotations: []}],
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

  const getFrames = vi.fn<Extract<InstagramMedia, {kind: 'video'}>['getFrames']>();
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
        caption: content.caption,
        location: content.location,
        [Symbol.asyncDispose]: async () => {},
        ...(content.images?.length
          ? {
              kind: 'carousel' as const,
              images: content.images.map(image => ({
                ...image,
                timestampSeconds: image.timestampSeconds ?? null,
              })),
            }
          : {
              kind: 'video' as const,
              durationSeconds: 60,
              transcript: content.transcript ?? [],
              getFrames,
            }),
      },
      catalog,
      {...fixture.options, ...options},
      signal,
    );

  return {run, google, requests, fetcher, getFrames};
}

describe('Instagram capture', () => {
  it('feeds candidates back and resolves selected tags and authoritative place metadata', async () => {
    const {run, google, requests} = harness();
    const result = await run();

    expect(google.search).toHaveBeenCalledExactlyOnceWith('Example Cafe NYC', 5);
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
    expect(requests[0]!.tools).toHaveLength(1);
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
    expect(await run()).toEqual(result);
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
    expect(await run()).toEqual({places: [], unresolved: []});
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

  it('passes images with their timestamps to the model', async () => {
    const {run, requests} = harness([response([final({places: [], unresolved: []})])]);
    await run(
      {},
      {
        ...fixture.content,
        images: [{url: 'data:image/jpeg;base64,YQ==', timestampSeconds: 3}],
      },
    );
    expect(requests[0]!.input).toEqual([
      expect.objectContaining({
        content: expect.arrayContaining([
          {type: 'input_text', text: 'Image 1 at 3s'},
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
