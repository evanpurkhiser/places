# Places - Product Spec

## Product Vision

Build a personal, hackable saved-places service that is easy to capture into and powerful to query. The core goal is to outperform list-based map tools by making filtering and sorting first-class.

## Problem

Current saved-places tools (especially list-based workflows) break down as volume grows.

- Saving is easy, but retrieval is hard.
- Filtering and sorting are limited or missing.
- List sprawl makes organization and discovery painful.
- Dynamic intent views (for example, hide food/drink while traveling) are hard to express.

## User Needs

Save places quickly for different reasons:

- Been there and liked it
- Saw it in person and it looked good
- Heard about it from a friend
- Saw it in social content (for example Instagram reels)

Retrieve places by intent using flexible queries, for example:

- "show me all cafes that are open right now and are less than a 20m walk from me"
- "show only museums on the map open at 3pm"
- "show cafes or breakfast spots"
- "hide food/drink places right now"

## Core Product Principles

- API-first so agents can read from and write to the system.
- Internal place identity is a UUID; a unique Google Place ID identifies the provider record.
- Support quick capture first; advanced filtering is staged.
- Replace list-centric organization with tag-centric organization over time.

## Data model and remaining enrichment

- Persist places by internal UUID with a unique Google Place ID.
- Cache selected Google place metadata for display and filtering.
- Store lightweight user context on save (tags, source/reason when available).
- Store discovery sources as records with a URL, type, description, and JSON data.
  Sources can represent Instagram posts or Google Maps imports. See
  [Sources](sources.md) for the initial model and open decisions.
- Preserve multiple discovery sources for a place so users can revisit each
  recommendation, including distinct Instagram posts about the same place.
- Eventually absorb `instagram-saver`'s Instagram URL-to-places extraction workflow.

## Tagging Direction

Tagging starts simple, but must evolve to support both manual and metadata-driven organization.

- Early: manual, freeform tags.
- Next: optional tag typing (for example location, type, source, occasion).
- Later: metadata-informed auto-tagging/suggestions with user override.

## Implementation status

The API and CLI support queued imports, place/tag management, explicit metadata
sync, and typed search. The web package renders saved places with viewport and
query filtering; capture/editing in the web UI remains planned. Google Text Search
is available through the API and CLI.

Boolean/tag/text/presence filters, geographic radius/rectangle/sector functions,
and recurring opening-hours filtering are implemented. Area boundaries, route corridors, travel-time budgets,
named locations, saved queries, and query explanations remain future work. See
[grammar status](search-grammar.md#implementation-status) for the detailed breakdown.

## Phased Plan

These milestones organize the product goals; their implementation notes describe
current coverage and remaining work.

### V0 - Ingest, Store, Display

Implemented through queued oRPC imports, PostgreSQL persistence, and the web map.
See [V0](specs/V0.md) for the current contracts.

- Add place via API using Google Place ID.
- Save into DB.
- Optionally cache basic Google place info.
- Render saved places on a map.

Outcome: prove end-to-end saved-place pipeline.

### V0.5 - Import Existing Saved Places

Individual Maps/Takeout place links and existing-place annotations are supported.
A built-in list/archive import command remains planned.

- Import existing places from current Google Maps lists.
- Tag imported places with source list context.
- Handle duplicate place IDs across lists while preserving list context.

Outcome: migrate existing saved-place corpus into the service without losing context.

### V1 - Capture UX

API/CLI search and import are implemented; web capture is planned.

- Add place from app UI via simple search + select.
- Keep API add for agents and automation.
- Keep this intentionally minimal and fast.

Outcome: daily capture is low-friction.

### V1.5 - Filter Foundations

Implemented with freeform normalized tags and a typed, composable query engine.

- Define a shared query language for API and CLI retrieval. See
  [Search grammar](search-grammar.md) for boolean expressions, explicit tag filters,
  strings and wildcards, geographic functions, and opening-hours predicates.
- Add structured tag support and basic filter primitives.
- Support combinations like type/tag OR queries.
- Support context hides (for example hide food/drink).

Outcome: practical retrieval replaces list sprawl.

### V2 - Contextual Filtering

Recurring hours and geometric filtering are implemented. Walking-time budgets
and route/detour evaluation remain future work.

- Open now / open at specific time filtering.
- Distance and walking-time filters.
- Combined intent queries (for example open now + within 20m walk + category).

Outcome: intent-driven discovery in real situations (travel, planning, day-to-day).
