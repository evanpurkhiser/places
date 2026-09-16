# Personal Map Saved Places Service - Product Spec

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
- Canonical place identity is Google Place ID.
- Support quick capture first; advanced filtering is staged.
- Replace list-centric organization with tag-centric organization over time.

## Data Direction (Early)

- Persist places in a database keyed by Google Place ID.
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

## Phased Plan

### V0 - Ingest, Store, Display

- Add place via API using Google Place ID.
- Save into DB.
- Optionally cache basic Google place info.
- Render saved places on a map.

Outcome: prove end-to-end saved-place pipeline.

### V0.5 - Import Existing Saved Places

- Import existing places from current Google Maps lists.
- Tag imported places with source list context.
- Handle duplicate place IDs across lists while preserving list context.

Outcome: migrate existing saved-place corpus into the service without losing context.

### V1 - Capture UX

- Add place from app UI via simple search + select.
- Keep API add for agents and automation.
- Keep this intentionally minimal and fast.

Outcome: daily capture is low-friction.

### V1.5 - Filter Foundations

- Add structured tag support and basic filter primitives.
- Support combinations like type/tag OR queries.
- Support context hides (for example hide food/drink).

This is expected to be higher priority than expanding capture UX beyond the minimal V1.

Outcome: practical retrieval replaces list sprawl.

### V2 - Contextual Filtering

- Open now / open at specific time filtering.
- Distance and walking-time filters.
- Combined intent queries (for example open now + within 20m walk + category).

Outcome: intent-driven discovery in real situations (travel, planning, day-to-day).
