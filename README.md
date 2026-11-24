# Places

A personal, self-hosted, tag-based tool for **saving, organizing, and mapping places**. Save the cafes, restaurants, museums, parks, and spots you want to remember — then find them again by *why* you saved them, not by which list you filed them in.

---

## Table of Contents

1. [What is Places?](#what-is-places)
2. [The problem it solves](#the-problem-it-solves)
3. [Design philosophy](#design-philosophy)
4. [Features](#features)
5. [How it's built](#how-its-built)
6. [Technology stack](#technology-stack)
7. [Prerequisites](#prerequisites)
8. [Setup](#setup)
9. [The web map](#the-web-map)
10. [The server](#the-server)
11. [The CLI](#the-cli)
12. [The query language](#the-query-language)
13. [Places, sources, and metadata](#places-sources-and-metadata)
14. [Instagram ingestion](#instagram-ingestion)
15. [Background jobs and queues](#background-jobs-and-queues)
16. [HTTP API](#http-api)
17. [Development](#development)
18. [Running in a container](#running-in-a-container)
19. [Roadmap](#roadmap)
20. [More reading](#more-reading)
21. [Glossary](#glossary)
22. [License](#license)

---

## What is Places?

Places is a **saved-places service** that you run yourself. You feed it links — a Google Maps share link, a `gmaps:` place ID, or an Instagram post — and it stores each place with:

- **Tags** that describe *what* and *why* (e.g. `type.cafe`, `attr.nice-bathroom`, `cuisine.japanese`).
- **Notes** on the place and on individual tag assignments.
- **Sources** recording *where* you discovered it (a specific Instagram post, a Google Maps import).
- **Cached metadata** (name, address, coordinates, hours, business status) kept fresh via Google.

Later, you query that collection by **intent** — "cafes open right now within a mile" — and see the results on a map.

It is **API-first**: every operation the command-line tool performs is available through a typed API, so scripts and AI agents can read and write your collection the same way you do.

---

## The problem it solves

Most "saved places" tools are built around **lists**, and lists break down as a collection grows:

### Saving is easy, retrieval is hard

You save a place in two taps, but six months later you can't remember which list it's in — or *why* you saved it. The cost of capture is near zero; the cost of retrieval is high.

### Filtering and sorting are limited or missing

"All breakfast spots open on a Sunday morning" is not something a list can answer. You'd have to scan every list, open every place, and check the hours yourself.

### List sprawl makes organization painful

You start with "Restaurants", then need "Restaurants — Thai", then "Restaurants — Thai — lunch", and the hierarchy collapses under its own weight. Lists don't compose; they multiply.

### Intent is hard to express

"Hide food and drink places while I'm traveling" or "only museums open at 3pm" are *views* over your data, not places in a bucket. Lists can't represent them.

### The Places answer

Places makes **filtering and sorting the core feature** and replaces lists with **tags**:

- A tag is a lightweight label you can apply to many places.
- Queries are **composable**: combine tags, text, geography, and opening hours with `AND`/`OR`/`NOT`.
- The result is a *view* you can express and re-run, not a folder you have to maintain.

---

## Design philosophy

A few principles drive the design:

1. **API-first.** Agents and scripts are first-class citizens. The CLI and web UI are clients of the same contract everything else uses.
2. **Stable internal identity.** A place's internal identity is a UUID; a unique Google Place ID identifies the provider record. They're deliberately separate.
3. **Quick capture first.** Getting a place *in* is fast and low-friction; advanced filtering is layered on top.
4. **Tag-centric, not list-centric.** Tags replace lists as the organizing primitive.
5. **Preserve discovery context.** A place can carry *multiple* sources so you can revisit each recommendation — including separate Instagram posts about the same place.

---

## Features

### Capture

- **Google Maps links** — paste a share link and it resolves to a Place ID.
- **`gmaps:<place_id>`** — import directly by Place ID.
- **Instagram posts and reels** — the ingestion worker scrapes the post and extracts the places it mentions.
- **Text search** — search Google by name/query (`coffee shops in East Village, NYC`).

### Organization

- **Tags** with namespaces (`type.cafe`, `attr.nice-bathroom`).
- **Tag notes** — per-assignment notes ("Code 1234" on the bathroom-door tag).
- **Place notes** — a general note on the place itself.
- **Archiving** — hide tags without deleting them or losing their associations.

### Retrieval

- A **typed query language** with boolean logic, wildcards, geographic functions, and opening-hours predicates.
- **Sorting** by name, save date, recommendation date, and distance.
- **Reference location** for distance queries ("what's near Union Square?").

### Data

- **Multiple sources per place** — every recommendation preserved, even separate posts about the same spot.
- **Cached Google metadata** — name, address, coordinates, time zone, business status, weekly hours.
- **Metadata sync** — refresh a place (or a filtered subset) on demand.

### Operations

- **Background import jobs** with automatic retries and seven-day status retention.
- **A web map** for browsing and querying.
- **Private by default** — served on your own Tailscale tailnet.

---

## How it's built

Places is a **TypeScript monorepo** managed with **pnpm**. The workspace (`pnpm-workspace.yaml`) contains four packages plus a design folder:

| Package | What it does |
|---------|-------------|
| `packages/server` | API implementation, business logic, database access, and place-provider integration (Google, Instagram). |
| `packages/cli` | The `places` command-line tool — a typed oRPC client of the server. |
| `packages/web` | The map interface (React + MapLibre) and API client. |
| `packages/common` | Shared API contracts, Zod schemas, inferred types, and the search/filter engine. |
| `design/` | Product spec, technical design notes, and implementation status. |

### Package responsibilities in detail

**`packages/server`** owns the database and everything that touches it:
- Drizzle table definitions and migrations.
- The Hono HTTP layer that hosts the oRPC router at `/rpc` and the MCP endpoint at `/mcp`.
- The pg-boss background-job setup and worker entrypoint.
- The Google Places client (Details + Text Search) and feature-ID conversion.

**`packages/cli`** owns argument parsing and command behavior:
- Optique-based parsers for every subcommand, with inferred TypeScript types.
- A typed oRPC client pointing at the configured server.
- JSON output for data commands, text output for docs, errors to stderr.

**`packages/web`** owns the map:
- React + `react-map-gl/maplibre` for rendering.
- TanStack Query for caching API results.
- Vite as the dev server and static build tool.

**`packages/common`** owns the shared surface:
- The oRPC contract and client type (`@places/common/contract`).
- Domain schemas (`@places/common/contract/tag`, `.../namespace`).
- The PEG-based search parser (`@places/common/search`) and the filter engine (`@places/common/filter-engine`).

---

## Technology stack

| Area | Choice | What it's for |
|------|--------|---------------|
| Language | TypeScript | Server, CLI, web, and shared contracts |
| Runtime | Node 24 | Runs TypeScript source directly via type stripping |
| Workspace | pnpm | Manages apps and shared packages |
| Database | PostgreSQL + PostGIS | Relational storage, JSONB source data, spatial queries |
| Database access | Drizzle ORM | Typed table definitions and queries |
| Migrations | Drizzle Kit | Schema migrations |
| Background jobs | pg-boss | PostgreSQL-backed queues, retries, scheduling |
| API | oRPC | Contracts, server procedures, typed clients |
| HTTP | Hono | Middleware, routing, `/health`, hosting oRPC |
| Validation | Zod | Runtime schemas and inferred types |
| CLI parsing | Optique | Typed arguments, options, subcommands |
| Configuration | YAML + Zod | File-based settings validated at startup |
| Testing | Vitest | Unit and integration tests |
| Web | React + MapLibre + TanStack Query | Map UI and API caching |
| Access | Tailscale | Restricts the service to your tailnet |

### Why these choices

- **Drizzle** gives typed SQL without a heavy ORM layer; its Zod helpers derive validators where a table's shape matches an operation's needs.
- **oRPC** is contract-first: you declare operations in `common`, implement them in `server`, and consume typed clients from `cli` and `web`.
- **Zod 4** implements the [Standard Schema](https://standardschema.dev/) interface, which oRPC accepts, so one schema type flows across the whole stack.
- **pg-boss** keeps jobs in PostgreSQL itself — no separate message broker to run.
- **Node 24 type stripping** means the server and CLI run TypeScript source directly, with `tsc --noEmit` used separately for type checking.

### Dependency baseline

Drizzle ORM 0.45, Drizzle Kit 0.31, and oRPC 1.15, all on the Zod 4 line. oRPC packages are kept on matching versions. The pnpm lockfile records the resolved versions.

---

## Prerequisites

To run Places locally you need:

- **Node 24** (`^24.22.1`).
- **pnpm** (`12.9.1`).
- **PostgreSQL** with the **PostGIS** extension available.
- **mise** (optional) for toolchain setup.
- **prek** (optional) for lint/format setup.

For the **Instagram ingestion worker** you'll also need `ffmpeg` and `ffprobe` on your `PATH` (both are bundled in the container image).

For **Google** imports and sync you need a Google Cloud project with the **Places API (New)** enabled and an API key.

For **Instagram** ingestion you need an OpenAI API key and access to the Instagram capture model.

---

## Setup

### 1. Toolchain

```bash
mise trust
mise install
```

`mise.toml` pins the Node and pnpm versions for the project.

### 2. Dependencies

```bash
pnpm install
prek install
```

`prek install` sets up the local lint/format tooling referenced in `prek.toml`.

### 3. Verify

```bash
pnpm lint
pnpm format:check
```

Both should pass before you start changing things.

### 4. Configure the server

Copy the example config and fill in your database URL and Google API key:

```bash
cp packages/server/config.example.yaml packages/server/config.yaml
```

The file is Git-ignored and validated with Zod at startup (unknown keys are rejected).

### 5. Migrate and run

```bash
pnpm --filter @places/server db:migrate
pnpm server
```

The server defaults to `127.0.0.1:5188`.

---

## The web map

```bash
pnpm web
```

Starts the Vite dev server and opens the map at `http://127.0.0.1:5187`. It proxies API calls to `http://127.0.0.1:5188`.

The web package renders saved places with **viewport and query filtering**. Capture and editing in the web UI remain planned — the CLI is the current capture surface.

---

## The server

The server is a Hono app hosting the oRPC router. Config is a YAML file validated by a Zod schema at startup.

### Configuration reference

```yaml
server:
  host: 127.0.0.1      # bind address
  port: 5188           # HTTP port

database:
  url: postgres://places:password@127.0.0.1:5432/places

google:
  apiKey: your-google-places-api-key

workers:
  gmaps-import:
    batchSize: 1
    concurrency: 1
  gmaps-sync:
    batchSize: 1
    concurrency: 1

instagram:
  openai:
    key: your-openai-api-key
  # capture model and tagging rules
  alwaysApplyTags: []        # applied on creation, combined with captured tags
  excludedTags: []           # extra exclusions
  excludedNamespaces: []     # exclude groups (e.g. personal ratings)
  requiredNamespaces: []     # require a classification (e.g. type.cafe)
```

- Every field carries a Zod description (surfaced in errors and docs).
- `--config /absolute/path/to/config.yaml` selects another file for `server`, `worker`, and `db:migrate`.
- The validated config and database pool are exposed to handlers through typed Hono and oRPC contexts.

### Migrations

Drizzle Kit manages the schema. Migration files live alongside the table definitions in `packages/server`.

```bash
pnpm --filter @places/server db:migrate
```

The **initial migration enables PostGIS**, so the role running migrations needs permission to install that extension.

### Server endpoints

- `/rpc` — the typed oRPC API.
- `/mcp` — Streamable HTTP MCP, exposing the same operations to AI agents.
- `/health` — HTTP health check.

---

## The CLI

The `places` command is the primary interface. Run it as `pnpm places` from the repo root, or install it globally (see below).

### Global install

```bash
pnpm add -g ./packages/cli --global-bin-dir="$HOME/.local/bin"
places --help
```

Ensure `~/.local/bin` is on your `PATH` and Node 24 is available outside the repo. The install links to *this checkout* and its dependencies, so source edits take effect immediately.

### CLI configuration

The CLI reads `~/.config/places/config.yaml` (or `$XDG_CONFIG_HOME/places/config.yaml` when set):

```yaml
server: https://5188.prk.network
```

- `--config PATH` selects another config file (must exist; invalid configs error).
- `--server URL` overrides the configured server.
- With no config file, the CLI defaults to `http://127.0.0.1:5188`.

**Output conventions:**

- Data commands print **JSON** to stdout.
- Documentation commands print **text** to stdout.
- Errors print to **stderr**, with a nonzero exit status on failure.

---

### Tags

Tags are labels you attach to places. Names are either **qualified** (`type.cafe`) or **bare** (`favorite`).

```bash
pnpm places tags create 'type.cafe'
pnpm places tags create 'type.bar' --icon '🍸' --description 'Primarily visited for drinks'
pnpm places tags list
pnpm places tags get <id>
pnpm places tags update <id> 'type.coffee'
pnpm places tags update <id> --icon '☕' --description 'Cafe or coffee shop'
pnpm places tags update <id> --icon '' --description ''
pnpm places tags delete <id>
```

#### Tag name rules

- Names are **globally unique**, normalized by trimming and lowercasing.
- A qualified name has exactly **one dot**, with nonempty namespace and local-name parts (`type.cafe`).
- Bare names (`favorite`) have a `null` namespace.
- The namespace must **already exist** before creating or renaming a tag into it (unknown namespace → `404`; duplicate name → `409`).
- `tags list` returns tags sorted by qualified name.

#### Renaming

Renaming can move a tag between namespaces or to no namespace, while **preserving its ID, metadata, and place associations**:

```bash
places tags update <id> cuisine.coffee   # moves it into `cuisine`
places tags update <id> coffee           # removes namespace membership
```

#### Deleting

Deleting a tag removes its place associations but **preserves the places**.

#### Archiving

```bash
pnpm places tags update <id> --archive
pnpm places tags update <id> --unarchive
```

Archived tags (`archived: true`) are omitted from `tags list` and from the tags returned with places, while their assignments, notes, names, and IDs remain. Notable behaviors:

- Wildcard filters (`tag[*]`) still match archived tags.
- `has[tag]` counts only **active** tags, so `!has[tag]` includes places assigned *only* archived tags.
- `tags get <id>` still returns an archived tag directly.
- Archiving keeps the tag name reserved — nothing else can take it.
- New tags start active; restoring a tag makes it and its existing place assignments visible again.

#### Metadata

`create` and `update` accept `--icon EMOJI` and `--description TEXT`. Update accepts an optional name and preserves omitted fields. An empty string (`--icon ''` / `--description ''`) sets the field to `null`. Updates require at least one change.

---

### Namespaces

Namespaces group tags (`type.cafe` lives in the `type` namespace). Use `namespace` or the alias `ns`:

```bash
pnpm places namespace create type --icon '🏷️' --description 'What kind of establishment this is'
pnpm places ns list
pnpm places ns get <id>
pnpm places ns update <id> category
pnpm places ns update <id> --icon '📍' --description 'Place categories'
pnpm places ns update <id> --icon '' --description ''
pnpm places ns delete <id>
```

#### Namespace rules

- Names are **unique, trimmed, lowercase, and nonempty**. Colons are reserved as separators.
- Icons use the same `{emoji: string}` format as tags.
- Updates preserve omitted fields; empty values clear them.
- Renaming preserves the UUID and rewrites all member tags' prefixes **in the same transaction**.

#### Deleting a namespace

A namespace containing tags requires `--force`:

```bash
pnpm places ns delete <id> --force
```

This unlinks the tags and strips their namespace prefixes. Tag IDs, metadata, and place associations are preserved. If any resulting bare name already exists, the command reports a conflict and leaves everything unchanged.

The `namespaces` RPC exposes `list`, `get`, `create`, `update`, and `delete`. Listing returns namespaces sorted by name; duplicate names return `409` and missing IDs return `404`. Schemas are exported from `@places/common/contract/namespace`.

---

### Applying tags to places

```bash
pnpm places tag <place-id> attr.nice-bathroom
pnpm places tag <place-id> attr.nice-bathroom --notes 'Code 1234'
pnpm places tag <place-id> attr.nice-bathroom --notes ''
pnpm places untag <place-id> attr.nice-bathroom
```

- `tag` ensures the assignment exists and returns it, including its note.
- Omitted `--notes` preserves the current note; supplied text replaces it; an empty string clears it.
- `untag` removes the assignment and its note, preserving the place and the shared tag definition.
- `untag`'s `removed` result is `false` when the tag was already unassigned.
- Both commands error on an unknown place or tag.

---

### Importing places

#### Basic imports

```bash
# Google Maps share link
pnpm places import 'https://maps.app.goo.gl/jbJWNK3airzeACCC7'

# Google Place ID
pnpm places import 'gmaps:ChIJ...'
pnpm places import 'gmaps:ChIJ...' --wait

# Instagram post/reel
pnpm places import 'https://www.instagram.com/p/SHORTCODE/' --wait --tag type.cafe

# Search Google for a candidate to import
pnpm places search-gmaps 'coffee shops in East Village, NYC'
```

#### Tagging and notes on import

```bash
pnpm places import 'gmaps:ChIJ...' --tag type.cafe --tag <tag-id>
pnpm places import 'gmaps:ChIJ...' --notes 'Try the espresso tonic'
pnpm places import 'gmaps:ChIJ...' --tag-note attr.nice-bathroom 'Code 1234'
```

- Repeat `--tag NAME_OR_ID` to apply existing tags by name or UUID. Names are trimmed and lowercased. Unknown tags are rejected **before** queuing. Repeated tags are applied once.
- `--notes TEXT` stores a general note when creating the place. Re-importing an existing place preserves its tags, tag notes, and place notes while attaching the new source.
- `--tag-note NAME_OR_ID NOTE` applies a tag *and* a note on that assignment. Repeat for multiple tags. An empty/omitted note creates the assignment without a note. If multiple notes resolve to the same tag, the last one wins.

#### Tracking jobs

```bash
pnpm places import runs
pnpm places import runs --limit 100
pnpm places import runs <job-id>
```

#### Import semantics

- Import returns a **job ID** and provider type (`gmaps` or `instagram`).
- `--wait` polls once per second until completion and prints `jobId`, `type`, `state`, `placeIds`, and `error` as JSON. Failed or cancelled jobs exit nonzero. Ctrl-C stops waiting while the queued job keeps running.
- The Google worker fetches Place Details (Enterprise + Atmosphere SKU), stores the raw JSON in `googleMetadata`, and inserts the place with typed fields and `lastSync` set. Existing places are reused.
- Failed attempts leave no partial place; pg-boss retries three times with backoff.
- Status comes from pg-boss and is temporary (completed jobs retained for seven days).

#### Supported input URLs

- `query_place_id`
- `q=place_id:...`
- `ftid`
- Maps place links with identifiers in their `data=` payload (including Google Takeout exports)
- Instagram post/reel URLs

Short links are expanded with validated redirects. Feature IDs are converted locally to Place IDs using a reverse-engineered binary layout, then validated through Place Details. Links must identify a specific place; otherwise supply `gmaps:<place_id>`.

---

### Listing and sorting

```bash
pnpm places list
pnpm places list --sort name
pnpm places list --sort name-desc
pnpm places list --sort recently-recommended
pnpm places list --sort recently-saved-asc
pnpm places list --reference-location 'point(-73.985, 40.726)' --sort distance
pnpm places list --reference-location 'Union Square, NYC' --query 'location[radius(@ref, 5mi)]'
```

`--query QUERY` and `--sort ORDER` combine freely.

#### Sort orders

- `name` — name from A–Z.
- `recently-saved` — newest saved date first (**default**).
- `recently-recommended` — newest source association first; places without a source fall back to their saved date.
- `distance` — nearest to `--reference-location` first.

Append `-asc` or `-desc` for explicit direction (`name-desc` = Z–A, `recently-saved-asc` = oldest first). Distance sorting requires `--reference-location`; `distance-desc` sorts farthest first.

---

### Syncing Google metadata

```bash
pnpm places sync
pnpm places sync --query 'tag[type.cafe]'
pnpm places sync-status <job-id>
```

- `sync` selects saved places (same query syntax as `list`) and queues one job per place. With no query it selects all places.
- The response includes `matched`, `queued`, `alreadyQueued`, and `jobIds`.
- Pending and active jobs are deduplicated per place.
- Run the worker to process them; transient failures retry three times with backoff.
- Sync status reports `updated`, `unchanged`, `missing`, or `superseded` after completion.

Each refresh updates `googleMetadata` and its typed projections (place ID, name, address, Maps URL, coordinates, time zone, business status, weekly hours) while preserving notes, tags, and sources. `lastSync` records successful refreshes (even unchanged); `updatedAt` advances when saved metadata changes. Failed requests leave saved data intact. A refreshed Google ID replaces the saved provider ID while preserving the internal UUID — and if another saved place already owns that ID, the refresh fails atomically, preserving both.

---

### Reference location

`places list` and `places sync` accept `--reference-location POINT`. The value uses the query language's geographic point syntax (e.g. `point(-73.985, 40.726)`) or an unquoted place name, and is available to the query as `@ref`. The API accepts the same value as `referenceLocation`.

---

### Discover the query language

```bash
pnpm places docs filter
```

Renders the registered filters, functions, value types, and examples as plain text, generated from `query.describe`.

---

## The query language

A small, typed, composable language for filtering. The same syntax works in the CLI and the API.

### Structure

Queries combine predicates with `AND`, `OR`, and `NOT`:

```
tag[favorite] AND !tag[visited]
(name[coffee] OR tag[type.bakery]) !has[notes]
```

### Supported filters

| Filter | What it matches |
|--------|-----------------|
| `tag` | Exact tag names and `*` wildcard patterns |
| `source` | Discovery source by provider type, ID, URL, or text |
| `name` | Place name |
| `address` | Place address |
| `notes` | Place notes |
| `has` | Presence of `tag`, `source`, `name`, `address`, or `notes` |
| `location` | Geographic area (radius, rectangle, sector) |
| `open` | Opening hours |

### Tag filters

```
tag[laptop-friendly, notes:outlet]
```

Matches places tagged `laptop-friendly` *with* a note containing `outlet` on that same assignment. `notes:` inside a tag predicate matches that assignment's note, not the place's general note.

### Source filters

```
source[instagram]
source[type:instagram]
source[id:"10000000-0000-4000-8000-000000000001"]
source[instagram, text:coffee]
source[url:"https://www.instagram.com/p/POST/"]
source[text:coffee] source[text:cocktails]
!has[source]
```

- **Type** matches a complete value, ignoring case.
- **IDs and URLs** match exactly (including URL case and trailing slashes).
- **`text`** searches source descriptions, Instagram captions, and the place's source-association description using substring matching, `*` wildcards, or `=` for exact literal matches.
- Separate source predicates can match different sources attached to the same place.
- `source[]` and `has[source]` require any attached source; `!source[...]` excludes places with a matching source.

### Location filters

```
location[radius(point(-73.985, 40.726), 1mi)]
location[rect(topLeft, bottomRight)]
location[sector(origin, towards:destination)]
location[sector(origin, bearing:90deg, range:2mi)]
```

- **`radius(point(longitude, latitude), distance)`** — within a distance. Units: `m`, `km`, `ft`, `mi`.
- **`rect(topLeft, bottomRight)`** — within a bounding rectangle.
- **`sector(origin, ...)`** — a wedge; supports `towards`, `bearing`, `range`, `spread`, and `buffer`.

Points also accept place names, addresses, `"gmaps:<place_id>"`, and Google Maps links. Names resolve through Google Places Text Search using `google.apiKey`; include a city or region to guide it. The first Google result provides the origin. Independent lookups run concurrently; repeated names share one lookup per query.

### Open-hours filters

```
open[@now]
open[@now, for:2h]
open["mon 6pm", until:"tue 2am"]
open["2026-09-21T18:00:00-04:00"]
```

- **Time values:** `@now`, clock times (`6pm`, `22:00`), weekday times (`"MON 6pm"`), ISO timestamps.
- **`for:2h` / `until:`** require continuous opening. Duration units are `m` and `h`.
- Clock times mean "today in each place's time zone".
- `!open[@now]` selects **known-closed** places (missing hours remain unknown under negation).

### How hours are represented

Hours are pairs of `[inclusive-start, exclusive-end]` minute offsets from Sunday midnight, between 0 and 10080:

- Monday 09:00–12:00 → `[[1980, 2160]]`
- 24/7 → `[[0, 10080]]`
- `null` → unknown
- `[]` → known closed all week

`list` includes nullable `timeZone`, `businessStatus`, `googleMetadata`, `lastSync`, and `hoursWeeklyOpen`. The `open` filter evaluates this saved weekly schedule (from the last sync), which may differ on holidays.

### The parser and engine

- `@places/common/search` exports a PEG-based parser:

  ```ts
  import {parseQuery} from '@places/common/search';

  const query = parseQuery(
    'tag[laptop-friendly, notes:outlet] location[radius(point(-73.985, 40.726), 1mi)]',
  );
  ```

  It returns a syntax tree with source locations.

- `@places/common/filter-engine` owns validation and resolution. `prepare(input)` validates the complete query against registered filter and function signatures; syntax and semantic errors throw `SearchError` with structured diagnostics.

- Server registrations produce Drizzle SQL predicates.

Regenerating the parser after editing `packages/common/src/search/grammar.pegjs`:

```bash
pnpm --filter @places/common generate:search
```

The generated parser ships with the sources; tests check it matches the grammar. Generation uses [Peggy](https://peggyjs.org/documentation.html).

---

## Places, sources, and metadata

### Place identity

- A place's internal identity is a **UUID**.
- A unique **Google Place ID** identifies the provider record.
- The two are separate: refreshing a Google ID replaces the provider ID while preserving the UUID.

### Stored fields

Each saved place carries:

- `coordinates` (`latitude`/`longitude`), `name`, `address`.
- `timeZone`, `businessStatus` (nullable).
- `googleMetadata` — the cached raw JSON from Google.
- `hoursWeeklyOpen` — the structured weekly schedule.
- `lastSync` — when metadata was last refreshed.
- `tags` — an array of associations (`placeId`, `tagId`, `note`, `createdAt`, plus the nested `tag`), ordered by tag name.
- `sources` — an array of discovery records, ordered newest first.

Untagged places have an empty `tags` array; places without sources have an empty `sources` array.

### Sources

A **source** records *where* you discovered a place. Each association carries its place-specific `description` and `data`, timestamps, and the complete nested `source` record. Sources can represent Instagram posts or Google Maps imports. Sources saved without provider metadata have `null` `source.data`.

Filtering by a source returns **all** source associations on each matching place — so you can revisit every recommendation, including separate Instagram posts about the same spot.

---

## Instagram ingestion

Pasting an Instagram post or reel URL queues an **ingestion job** keyed by the post's shortcode.

### What the job does

1. **Skips** if the source already exists.
2. **Scrapes and prepares** the media.
3. **Captures recommendations** — the places the post mentions.
4. **Atomically saves** the source plus a batch of Google import jobs.

Completion returns `sourceId`, child `jobIds`, unresolved mentions, and whether ingestion was skipped. Child jobs import places independently; Instagram job completion means capture and dispatch have finished.

### Behavior details

- A repeated post skips capture and follows retained child jobs (including failures); after those jobs expire it returns the source's saved places.
- Queue history is retained for seven days after completion.
- The queue defaults to one worker with a batch size of one.
- Local workers need `ffmpeg` and `ffprobe` on `PATH`; the container includes them.
- Thumbnail metadata contains Instagram's remote cover URL.

### Configuration

Under `instagram:` in the server YAML:

```yaml
instagram:
  openai:
    key: your-openai-api-key
  # capture model and tagging rules
  alwaysApplyTags: []        # applied on creation, combined with captured tags
  excludedTags: []           # extra exclusions
  excludedNamespaces: []     # exclude groups (e.g. personal ratings)
  requiredNamespaces: []     # require a classification (e.g. type.cafe)
```

- `alwaysApplyTags` are combined with captured tags when creating a place; existing places keep their tags and notes while gaining the source association.
- Automatic tags are excluded from model choices.
- `requiredNamespaces` forces a classification such as `type.cafe` or `type.restaurant`.
- All four lists accept `[]`.
- For review-before-display, include `status.needs-review` in `alwaysApplyTags` and exclude it from map queries.

---

## Background jobs and queues

pg-boss runs two queues: **`gmaps-import`** and **`gmaps-sync`**. Workers run as a separate process from the HTTP server, sharing business logic and database code within `packages/server`.

```bash
pnpm server    # HTTP API
pnpm worker    # background jobs
```

Both accept `--config /absolute/path/to/config.yaml` and use the same database.

### Throughput

```yaml
workers:
  gmaps-import:
    batchSize: 1
    concurrency: 1
  gmaps-sync:
    batchSize: 1
    concurrency: 1
```

- `concurrency` — number of polling workers for that queue per process.
- `batchSize` — how many jobs each worker claims and runs concurrently.
- Max in-flight jobs per queue per process = `concurrency × batchSize`.
- Every job retains its own result and retries independently of other batch members.
- Restart the worker after changing configuration.
- Additional worker processes each apply these limits independently.

pg-boss creates and manages its own schema at startup. Jobs are designed to be safe to retry: reprocessing a source reuses canonical places and source associations. Database transaction atomicity covers local writes; external API calls need their own retry handling.

---

## HTTP API

The typed oRPC API lives at `/rpc`. Additional endpoints:

| Endpoint | Purpose |
|----------|---------|
| `/rpc` | Typed oRPC API |
| `/mcp` | Streamable HTTP MCP (agents) |
| `/health` | Health check |
| `/api/imports` | REST import submission and polling |

### REST import

```bash
curl -i https://places.prk.network/api/imports \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.instagram.com/p/SHORTCODE/"}'

curl https://places.prk.network/api/imports/<job-id>
```

- The URL may be an Instagram post/reel, a Google Maps place URL, or a `gmaps:<place_id>` input.
- Submission returns `202 Accepted` with `jobId` and `type`.
- Poll `/api/imports/<jobId>` for `state`, `placeIds`, `placeNames`, `error`, and `sourceId`. The source ID is available for Instagram imports after capture; Google Maps imports return `null`.

### RPC operations

The contract exposes (via the CLI and API alike):

- Tag operations — `list`, `get`, `create`, `update`, `delete`.
- Place imports — `places.import`, `places.getImportRun`, `places.listImportRuns`.
- Saved places — `places.list`.
- Metadata sync — `places.sync`, `places.syncStatus`.
- Associations — `places.tag`, `places.untag`.
- Provider search — `places.searchGoogle`.
- Capability discovery — `query.describe`.

Shared contracts live in `@places/common/contract`; tag schemas in `@places/common/contract/tag`.

---

## Development

### Checks

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

### Testing

- **Unit and integration tests** run with Vitest across the server, CLI, web, and shared packages.
- **Database integration tests** run when `TEST_DATABASE_URL` points at a PostgreSQL instance with PostGIS. They create and drop a separate randomly-named database, so the role needs database-creation and extension permissions.
- **CLI integration tests** bind `127.0.0.1` on ports 15188, 15189, 15190, and 15191.

```bash
TEST_DATABASE_URL=postgres://places:places@127.0.0.1:5432/places pnpm test
```

### Lint, format, typecheck

- `pnpm lint` — oxlint across the workspace.
- `pnpm format:check` — oxfmt check.
- `pnpm format` — oxfmt write.
- `pnpm typecheck` — `tsc --noEmit` in each package.

### CI

- The **lint workflow** runs prek (lint + formatting).
- The **build workflow** runs typechecking and tests against PostGIS before building the image.
- Both run on pull requests and pushes to `main`.
- Pushes to `main` publish `ghcr.io/evanpurkhiser/places:latest`; PRs build without publishing.

---

## Running in a container

The image runs Node directly with production dependencies and the shared workspace contracts.

### Build

```bash
podman build -t places .
```

(Docker works too.)

### Run

```bash
podman run --rm -v /etc/places.yaml:/etc/places.yaml:ro ghcr.io/evanpurkhiser/places:latest
```

Mount a YAML config read-only at `/etc/places.yaml`. Use the same config for server, worker, and migrate.

### Container config

```yaml
server:
  host: 0.0.0.0
  port: 5188
database:
  url: postgres://places:password@postgres:5432/places
google:
  apiKey: your-google-places-api-key
```

PostgreSQL + PostGIS runs separately; its hostname must be reachable from the containers. Within a Podman pod, use `127.0.0.1` (containers share a network namespace). Publish the HTTP port on host loopback. Keep the config readable only by the service account and mount it into each container.

### Command variants

```bash
# migrations only
podman run --rm --network places -v /etc/places.yaml:/etc/places.yaml:ro \
  ghcr.io/evanpurkhiser/places:latest migrate

# background worker
podman run --rm --network places -v /etc/places.yaml:/etc/places.yaml:ro \
  ghcr.io/evanpurkhiser/places:latest worker
```

- The default `server` command runs migrations before serving; if a migration fails, the container exits.
- Start or update the server before the worker so the schema is ready.
- Node receives container stop signals directly.
- `/health` serves the HTTP health check.
- Application containers keep their persistent state in PostgreSQL.

---

## Roadmap

From `design/PRODUCT_SPEC.md`:

### V0 — Ingest, store, display *(done)*

Add a place by Google Place ID, save it, optionally cache basic info, and render saved places on a map.

### V0.5 — Import existing saved places *(partial)*

Individual Maps/Takeout place links and existing-place annotations are supported. A built-in list/archive import command remains planned.

### V1 — Capture UX *(partial)*

API/CLI search and import are done; web capture is planned. The goal is low-friction daily capture.

### V1.5 — Filter foundations *(done)*

Freeform normalized tags and a typed, composable query engine: boolean expressions, explicit tag filters, strings and wildcards, geographic functions, and opening-hours predicates.

### V2 — Contextual filtering *(partial)*

Recurring hours and geometric filtering are done. Walking-time budgets and route/detour evaluation remain future work.

### Still planned

- Area boundaries and route corridors.
- Named locations (`@home`).
- Saved queries and query explanations.
- Capture/editing in the web UI.
- Importing existing Google Maps lists.

---

## More reading

In `design/`:

| Document | What it covers |
|----------|----------------|
| `PRODUCT_SPEC.md` | Product vision, user needs, phased plan |
| `search-grammar.md` | The query language and implementation status |
| `filter-engine.md` | Filter registration and resolution architecture |
| `tech.md` | Stack decisions and rationale |
| `sources.md` | Source model and source filtering |
| `place-metadata.md` | Stored fields and coordinate projection |
| `hours.md` | Weekly-hours representation |
| `time-values.md` | Time-interval and time-zone rules |
| `instagram-import.md` | Instagram ingestion workflow |

---

## Glossary

- **Place** — a saved location, identified internally by a UUID and externally by a Google Place ID.
- **Tag** — a label on a place; qualified (`type.cafe`) or bare (`favorite`).
- **Namespace** — the prefix of a qualified tag (`type` in `type.cafe`).
- **Source** — a record of where a place was discovered (Instagram post or Google Maps import).
- **Import** — a background job that resolves a link into a saved place.
- **Sync** — a background job that refreshes a place's Google metadata.
- **Qualified name** — a namespace, a dot, and a local name (`type.cafe`).
- **Reference location** — a point available to queries as `@ref`, used for distance filtering and sorting.
- **Tailnet** — your private Tailscale network; the default access boundary.

---

## License

MIT. See `LICENSE`.
