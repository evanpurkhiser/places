# Instagram import

Proposed design for importing places discovered in Instagram posts and Reels.
Sources are the first implementation milestone.

## Existing foundations

- `sources` and `place_sources` already exist in the database. Source APIs and
  typed payload contracts remain to be implemented; see [Sources](sources.md).
- `imports/index.ts` dispatches supported inputs to pg-boss queues. The CLI exposes
  `places import` and `places import-status` through the shared RPC contract.
- The Google service already supports candidate search and place details.
- `instagram-saver` fetches post metadata, transcribes video audio, and sends
  carousel images to the model. Its video path supplies no frames. Google matching
  happens after extraction and selects the first result.

## Source model

A source represents the original content. One Instagram post can describe several
places; each place can have several sources. Import attempts are executions and
have their own job identities.

Retain the existing source fields: `id`, `type`, `url`, `description`, `data`, and
timestamps. Define the API contract as a Zod discriminated union on `type`, with
the corresponding validated JSONB `data` shape. Source-specific payloads should
carry a schema version so persisted content can evolve.

Initial variants:

| Type        | Content                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `instagram` | Shortcode, media kind, caption, optional author/location, capture time, and optional transcript |
| `url`       | Original URL and optional title                                                                 |
| `note`      | User-authored source text                                                                       |

The existing `description` holds a readable summary. A source note describes where
the recommendation came from; a place's `userNote` holds the user's own thoughts.
Define `google_maps_import` when its batch/list/entry semantics are settled.
Inspect existing source types and payloads before enforcing the new contract.

Add a stable external identity and a database uniqueness constraint on
`(type, externalId)`. For Instagram, use the case-sensitive shortcode, normalizing
supported `/p/`, `/reel/`, and `/tv/` links and removing sharing parameters. URL
sources use normalized URLs; notes have no external identity. URL normalization
should preserve meaningful query parameters.

Keep place-specific recommendations on `place_sources`: a readable description
and typed data containing mentioned name, recommended items, atmosphere, source
evidence (such as transcript excerpt or frame timestamp), and a short match
explanation. Validate association payloads against the linked source's type.
Save concise evidence and conclusions, rather than internal model reasoning.

Source creation/upsert, get/list, update, attach, detach, and per-place source reads
form the first API slice, with matching CLI operations. Attachment is idempotent
through the existing composite key. Detaching preserves the source; explicitly
deleting a source removes its associations and preserves places.

Render a link and source summary first. A future embed can be derived from the
source type and URL. Retain useful text metadata; downloaded media and sampled
frames are temporary artifacts with explicit cleanup.

## Import pipeline

1. Validate and normalize the Instagram URL, then enqueue an `instagram-import`
   job. Return its ID immediately.
2. Fetch and validate post metadata through an Instagram service; upsert the source
   by shortcode. An unattached source is valid, including when no places are found.
3. Download media once. For video, extract audio and a bounded set of timestamped
   frames. Silent video can proceed with caption and frames. Carousel support can
   follow using the same extraction interface.
4. Assemble caption, location hints, transcript, frames, tag catalog, and tagging
   policy. Run extraction with read-only Google Places tools.
5. Validate resolved place IDs, tagging policy, and source associations. Persist
   accepted results through shared place-import application logic.
6. Return place IDs, source ID, unresolved mentions, and warnings through import
   status. Distinguish successful extraction with zero places from processing failure.

Separate provider fetching, media preparation, model extraction, and persistence.
Refactor shared place-saving behavior out of the Google job module rather than
making one queue handler invoke another. Perform external calls before the final
database transaction. Persist the validated result set atomically, including source
associations and tags, so a failed save can be retried coherently.

Instagram imports add associations and missing tags to existing places. Preserve
user notes and existing tag annotations. Explicit caller-supplied tags apply to
each imported place; define explicit note handling separately from model output.

## Model-assisted place resolution

Expose narrow tools backed by the existing Google service:

- `searchPlaces(query, limit)` returns several candidates with Google place IDs,
  names, addresses, coordinates, and Maps URLs.
- `getPlaceDetails(placeId)` provides details for a candidate when needed.

The model can revise a query using neighborhood, city, address, and visual clues,
inspect candidates, and decide whether the evidence identifies a particular branch.
Use Google Places search initially; it directly supplies canonical place IDs.

Final output must reference place IDs returned by tools during this run. Validate
that membership server-side, then fetch authoritative metadata for persistence.
This prevents invented IDs; evidence-based evaluation is still needed to assess
whether the model selected the correct real-world place. Ambiguous branches and
missing matches become unresolved mentions with reasons, available in the result.

Bound tool calls, candidate counts, tokens, media size/duration, frames, and total
runtime. Treat captions, transcripts, images, and tool results as untrusted content;
they provide evidence and cannot change import policy. The model receives read-only
tools and proposes changes for deterministic validation and persistence.

## Tagging policy

Provide all current tags and namespaces, including IDs, names, and descriptions.
Mark which assignments the importer may make. Return existing tag IDs and validate
them against the current catalog before saving; automatic tag creation is deferred.

Configure two complementary layers:

- User instructions explain judgment calls, such as assigning atmosphere tags only
  when the post provides clear evidence.
- Structured policy enforces forbidden namespaces/tags, required namespaces, and
  always-applied tags. A model instruction alone cannot enforce these constraints.

The proposed initial policy requires at least one `type.*` tag, forbids `rating.*`
and configured personal-state tags, and permits evidence-supported atmosphere tags.
If no supported type fits, return a policy issue for that mention; configure an
explicit fallback type if desired. Revalidate policy before writes. Existing
personal tags remain intact.

Start with installation-level settings in the server configuration: importer
instructions, policy, and model settings. Keep instructions separate from fixed
output/tool requirements. Record the effective policy and prompt version or hash
with the execution for reproducibility. A future settings API can expose the same
configuration without changing extraction semantics.

Source associations provide Instagram provenance. `source[type:instagram]` finds
places discovered on Instagram; `username` and `text` narrow the matching source.

## Review before map display

New places created by an Instagram import receive a configurable review tag,
provisionally named `needs-review`. Application code assigns it in the same
transaction that creates the place. This workflow tag is controlled by the importer
and user review actions; the model cannot assign or remove it.

The default map query excludes places carrying the review tag. A review view lists
those places with their source evidence, resolved Google location, and suggested
tags. Accepting a place removes the review tag, making it eligible for the default
map. An explicit query can include pending places when wanted.

Attaching an Instagram source to an existing place preserves its review state.
Retries and reprocessing also preserve that state, so a reviewed place stays
visible and a pending place stays pending. Determine whether a place is new from
the database insertion result to preserve this behavior under concurrent imports.

Keep the configured review tag stable and validate that it exists before importing.
Review tagging applies specifically to newly created places, separately from tags
configured to apply to every imported place.

## Jobs, retries, and phone entry point

Extend the importer registry and shared import type/result schemas so the existing
CLI command accepts Instagram URLs. Add optional CLI waiting through polling.

Provide a small JSON HTTP adapter for Shortcuts over the tailnet: a POST accepts a
URL and returns HTTP 202 with a job ID and status URL; a GET returns progress and
completed place summaries/links. Both reuse the import application layer. An
optional bounded wait can return the result if ready, otherwise return the same job
handle. Client disconnects leave the worker running. Notifications can consume
completion events later without being required for the initial flow.

Use queue-level deduplication to coalesce simultaneous requests for the same post,
plus database constraints for source/place/association identity. A repeated import
of completed content returns its existing result by default; explicit reprocessing
creates a new execution against the same source. Persist a small durable import
run record with outcome and result references because current queue records expire
after seven days. Define how coalescing handles different caller tags; requests
with different effective options must preserve each caller's requested assignments.

Record stages such as fetching, preparing media, extracting/resolving, and saving.
Give Instagram its own timeout, concurrency, and retry settings; the current
Google-import 60-second expiry should not be inherited unchanged. Retry transient
provider errors with limits. Invalid links, unsupported media, unavailable/private
posts, and unresolved place mentions should produce actionable outcomes. Save
validated extraction output before persistence so a database retry can reuse it.

Validate supported hosts and redirects on input and media fetching, bound resource
use, and document the tailnet access boundary for the new HTTP adapter.

## FFmpeg boundary

Start with a worker-only media module wrapping the FFmpeg executable. Make its
binary path configurable, check availability when enabling Instagram workers, and
install it in the worker runtime image. The API and CLI processes do not need it.
Use argument arrays, process timeouts, bounded output, and per-job temporary storage.

A separate workspace package is useful once media processing has another consumer.
It organizes code but does not eliminate the runtime binary dependency. A separate
media service can be introduced if deployment or resource isolation warrants it.

## Implementation order and validation

1. Sources: typed contracts, external identity migration, APIs/CLI, association
   reads, and tests for deduplication, validation, and deletion semantics.
2. Import application layer and durable execution results: preserve current Google
   behavior and verify concurrent imports, user-note/tag preservation, and review
   state across new places, existing places, retries, and reprocessing.
3. Instagram capture and media preparation: use fixtures for parsing, URL variants,
   missing audio, frames, resource limits, and temporary-file cleanup.
4. Extraction: configurable instructions/policy and the Google tool loop. Exercise
   multi-place posts, wrong branches, ambiguous matches, forbidden tags, unknown
   IDs, and tool-budget exhaustion with deterministic fake providers.
5. CLI and Shortcuts adapter: verify enqueue/status/wait behavior, duplicate
   submissions, retries, and successful zero-place outcomes. Run a small manually
   checked set of real posts to evaluate matching quality and latency.
6. Review flow: exclude pending places from the default map and verify that accepting
   a place removes its review tag and makes it eligible for display.

Before implementation, settle the initial tag policy against the actual catalog
and the desired reprocessing behavior for existing source descriptions and
associations.
