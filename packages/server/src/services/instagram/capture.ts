import {
  Agent,
  MaxTurnsExceededError,
  ModelBehaviorError,
  ModelRefusalError,
  OpenAIResponsesModel,
  Runner,
  ToolCallError,
  user,
} from '@openai/agents';
import type {UserMessageItem} from '@openai/agents';
import type OpenAI from 'openai';
import type {z} from 'zod';

import type {GooglePlaces} from '../google/index.ts';

import {CaptureError} from './errors.ts';
import type {InstagramPost} from './media.ts';
import {buildCapturePrompt} from './prompt.ts';
import {
  assignableTags,
  captureCatalog,
  captureContent,
  captureOptions,
  captureOutput,
  type CaptureCatalog,
  type CaptureOptions,
  type ParsedCaptureOptions,
} from './schema.ts';
import {collectSearchResults, createCaptureTools} from './tools.ts';

interface CaptureDependencies {
  openai: OpenAI;
  google: Pick<GooglePlaces, 'search'>;
}

/**
 * Select assignable tags and reject required groups that cannot be satisfied.
 */
function resolveAssignableTags(catalog: CaptureCatalog, options: ParsedCaptureOptions) {
  const allowed = assignableTags(catalog, options);

  const missingGroup = options.requiredNamespaces.some(name => {
    const group = catalog.namespaces.find(item => item.name === name);
    return !group || !allowed.some(item => item.namespaceId === group.id);
  });

  if (missingGroup) {
    throw new CaptureError(
      'invalid_configuration',
      'Each required tag group must contain an assignable tag.',
    );
  }

  return allowed;
}

/**
 * Package prepared text and images with labels the model can cite as evidence.
 */
function contentInput(post: InstagramPost): Exclude<UserMessageItem['content'], string> {
  const content = captureContent.parse({
    caption: post.caption,
    location: post.location,
    media: post.media,
  });

  return [
    {
      type: 'input_text',
      text: JSON.stringify({caption: content.caption, location: content.location}),
    },
    ...content.media.flatMap(
      (item): Exclude<UserMessageItem['content'], string> =>
        item.kind === 'image'
          ? [
              {type: 'input_text', text: `Image ${item.id}`},
              {type: 'input_image', image: item.image, detail: 'auto'},
            ]
          : [{type: 'input_text', text: JSON.stringify(item)}],
    ),
  ];
}

/**
 * Validate proposed selections and enrich them with Google metadata and tag IDs.
 */
function resolveResult(
  result: z.infer<ReturnType<typeof captureOutput>>,
  candidates: ReturnType<typeof collectSearchResults>,
  catalog: CaptureCatalog,
  options: ParsedCaptureOptions,
) {
  const places = result.places.map(item => {
    const candidate = candidates.get(item.googlePlaceId);

    if (!candidate) {
      throw new CaptureError(
        'invalid_output',
        'The model returned an unknown Google place ID.',
      );
    }

    const tags = [...new Set(item.tags)].map(
      name => catalog.tags.find(tag => tag.name === name)!,
    );
    const missingGroup = options.requiredNamespaces.some(name => {
      const group = catalog.namespaces.find(namespace => namespace.name === name)!;
      return !tags.some(tag => tag.namespaceId === group.id);
    });

    if (missingGroup) {
      throw new CaptureError(
        'invalid_output',
        'A captured place is missing a required tag group.',
      );
    }

    return {
      googlePlaceId: candidate.id,
      name: candidate.displayName.text,
      formattedAddress: candidate.formattedAddress,
      googleMapsUrl: candidate.googleMapsUri,
      coordinates: candidate.location,
      tagIds: tags.map(tag => tag.id),
      description: item.description,
      evidence: item.evidence,
      matchReason: item.matchReason,
    };
  });

  if (new Set(places.map(place => place.googlePlaceId)).size !== places.length) {
    throw new CaptureError(
      'invalid_output',
      'The model returned duplicate Google place IDs.',
    );
  }

  return {places, unresolved: result.unresolved};
}

/**
 * Analyze prepared Instagram content without writing places, sources, or tags.
 */
export async function capture(
  dependencies: CaptureDependencies,
  post: InstagramPost,
  catalogInput: CaptureCatalog,
  optionsInput: CaptureOptions,
  signal?: AbortSignal,
) {
  const options = captureOptions.parse(optionsInput);
  const catalog = captureCatalog.parse(catalogInput);
  const schema = captureOutput(resolveAssignableTags(catalog, options));
  const tools = createCaptureTools(dependencies.google, post);
  const timeout = AbortSignal.timeout(options.timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  requestSignal.throwIfAborted();

  const agent = new Agent({
    name: 'Instagram capture',
    model: new OpenAIResponsesModel(dependencies.openai, options.model),
    instructions: buildCapturePrompt(catalog, options),
    tools,
    outputType: schema,
    modelSettings: {
      parallelToolCalls: true,
      maxTokens: options.maxOutputTokens,
      ...(options.reasoningEffort ? {reasoning: {effort: options.reasoningEffort}} : {}),
      providerData: {store: false, include: ['reasoning.encrypted_content']},
    },
  });
  const runner = new Runner({tracingDisabled: true});
  const result = await runner
    .run(agent, [user(contentInput(post))], {
      signal: requestSignal,
      maxTurns: options.maxTurns,
    })
    .catch(error => {
      requestSignal.throwIfAborted();

      if (error instanceof MaxTurnsExceededError) {
        throw new CaptureError('turn_limit', 'Capture exceeded its model turn limit.');
      }

      if (error instanceof ModelRefusalError) {
        throw new CaptureError('refused', 'The model declined to capture this post.');
      }

      if (
        error instanceof ModelBehaviorError ||
        (error instanceof ToolCallError && error.error instanceof ModelBehaviorError)
      ) {
        throw new CaptureError(
          'invalid_output',
          'The model returned invalid output or tool arguments.',
        );
      }

      throw new CaptureError(
        'provider_unavailable',
        'A capture provider is unavailable.',
      );
    });
  requestSignal.throwIfAborted();

  if (!result.finalOutput) {
    throw new CaptureError('incomplete', 'The model did not complete capture.');
  }

  const parsed = schema.safeParse(result.finalOutput);

  if (!parsed.success) {
    throw new CaptureError(
      'invalid_output',
      'The model returned invalid places or tags.',
    );
  }

  return resolveResult(
    parsed.data,
    collectSearchResults(result.newItems),
    catalog,
    options,
  );
}

export type CaptureResult = Awaited<ReturnType<typeof capture>>;
