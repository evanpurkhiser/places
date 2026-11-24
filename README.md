# Places

A personal, self-hosted tool for saving, organizing, and mapping places,
built around **tags** instead of lists. Save a place from a Google Maps link,
a `gmaps:` ID, or an Instagram post, tag it, then find it again by intent
("cafes open now within a mile") and see it on a map.

## The problem it solves

List-based saved-places tools break down as a collection grows: saving is
easy, retrieval is hard, filtering is limited, and lists sprawl. Places makes
filtering and sorting the core feature and replaces lists with tags, so you
can express views like:

- cafes open now within a mile
- museums open at 3pm
- cafes **or** breakfast spots
- hide food/drink while traveling

It is API-first: the CLI and web UI are clients of the same typed contract
everything else uses, so scripts and AI agents can read and write your
collection too.

## How it's built

A TypeScript + pnpm monorepo:

- `packages/server` — API, database, and background jobs.
- `packages/cli` — the `places` command.
- `packages/web` — the map UI.
- `packages/common` — shared contracts and the query/filter engine.
- `design/` — product and technical specs.

Stack: Node 24, PostgreSQL + PostGIS, Drizzle, pg-boss, oRPC + Hono, Zod,
Vitest, React + MapLibre. Access is via Tailscale.

## Setup

```bash
mise trust && mise install
pnpm install
prek install
pnpm lint && pnpm format:check
```

Copy `packages/server/config.example.yaml` to `packages/server/config.yaml`,
set your database URL and Google API key, then:

```bash
pnpm --filter @places/server db:migrate
pnpm server     # API on 127.0.0.1:5188
pnpm worker     # background jobs (separate process)
pnpm web        # map at http://127.0.0.1:5187
```

The initial migration enables PostGIS, so the migration role needs
permission to install that extension. `server`, `worker`, and `db:migrate`
accept `--config PATH`.

## CLI

Run as `pnpm places`, or install globally:

```bash
pnpm add -g ./packages/cli --global-bin-dir="$HOME/.local/bin"
places --help
```

The CLI reads `~/.config/places/config.yaml` with `server: URL`; `--config`
and `--server` override it. Data commands print JSON, docs print text, errors
go to stderr with a nonzero exit.

### Tags

```bash
pnpm places tags create 'type.cafe'
pnpm places tags create 'type.bar' --icon '🍸' --description 'For drinks'
pnpm places tags list
pnpm places tags get ID
pnpm places tags update ID 'type.coffee'
pnpm places tags update ID --icon '' --description ''
pnpm places tags update ID --archive | --unarchive
pnpm places tags delete ID
```

- Names are globally unique, trimmed, and lowercase.
- Qualified (`type.cafe`) or bare (`favorite`); qualified names have one dot.
- Namespaces must exist before creating or renaming a tag into them.
- Renaming preserves the ID, metadata, and place associations.
- Deleting a tag keeps the places; it removes their associations.
- Archived tags are hidden from lists but keep their names reserved.
- `has[tag]` counts active tags only; wildcards still match archived tags.

### Namespaces

```bash
pnpm places namespace create type --icon '🏷️'
pnpm places ns list
pnpm places ns get ID
pnpm places ns update ID category
pnpm places ns update ID --icon '' --description ''
pnpm places ns delete ID            # add --force if it contains tags
```

Names are unique, trimmed, lowercase, nonempty; colons are reserved. Renaming
rewrites all member tags' prefixes in one transaction.

### Tagging places

```bash
pnpm places tag PLACE_ID attr.nice-bathroom
pnpm places tag PLACE_ID attr.nice-bathroom --notes 'Code 1234'
pnpm places untag PLACE_ID attr.nice-bathroom
```

`tag` ensures the assignment exists; omit `--notes` to keep the current note
or pass `''` to clear it. `untag` removes the assignment but keeps the place
and the shared tag.

### Importing

```bash
pnpm places import 'https://maps.app.goo.gl/...'          # Maps link
pnpm places import 'gmaps:ChIJ...' --wait --tag type.cafe
pnpm places import 'https://www.instagram.com/p/...' --wait
pnpm places search-gmaps 'coffee shops in East Village, NYC'
pnpm places import runs
pnpm places import runs --limit 100
pnpm places import runs JOB_ID
```

Import returns a job ID and provider type (`gmaps` or `instagram`). `--wait`
polls once per second until completion and prints the result as JSON. Repeat
`--tag` to apply tags, `--notes TEXT` for a place note, and `--tag-note NAME
NOTE` for a per-assignment note.

Supported inputs: `query_place_id`, `q=place_id:...`, `ftid`, Maps place
links with a `data=` payload (including Takeout exports), and Instagram
post/reel URLs. The Google worker fetches Place Details, stores the raw JSON
in `googleMetadata`, and sets `lastSync`. pg-boss retries three times with
backoff; completed job status is kept for seven days.

### Listing and sorting

```bash
pnpm places list
pnpm places list --sort name
pnpm places list --sort recently-recommended
pnpm places list --reference-location 'point(-73.985, 40.726)' --sort distance
pnpm places list --query 'tag[favorite] AND !tag[visited]'
```

Sort orders: `name`, `recently-saved` (default), `recently-recommended`, and
`distance`. Append `-asc` or `-desc` for direction. Distance sorting requires
`--reference-location`.

### Sync

```bash
pnpm places sync
pnpm places sync --query 'tag[type.cafe]'
pnpm places sync-status JOB_ID
```

Sync selects places (same query syntax as `list`), queues one job per place,
and refreshes their Google metadata. The response reports `matched`, `queued`,
`alreadyQueued`, and `jobIds`; status ends as `updated`, `unchanged`,
`missing`, or `superseded`.

## Query language

Filters: `tag`, `source`, `name`, `address`, `notes`, `has`, `location`, and
`open`. Combine with `AND`/`OR`/`NOT`.

```text
tag[favorite] AND !tag[visited]
tag[laptop-friendly, notes:outlet]
(name[coffee] OR tag[type.bakery]) !has[notes]
location[radius(point(-73.985, 40.726), 1mi)]
location[sector(origin, bearing:90deg, range:2mi)]
open[@now, for:2h]
open["mon 6pm", until:"tue 2am"]
source[instagram]
```

- `tag` supports exact names, `*` wildcards, and `notes:` on the assignment.
- `source` matches provider type, ID, URL, or `text` (substring, `*`, or `=`).
- `location` supports `radius`, `rect`, and `sector` (with `towards`,
  `bearing`, `range`, `spread`, `buffer`).
- Points accept place names, addresses, or `gmaps:PLACE_ID`; `@ref` refers to
  `--reference-location`.
- `open` accepts `@now`, clock times, weekday times, and ISO timestamps, plus
  `for:`/`until:` durations in `m`/`h`.
- Hours are minute offsets from Sunday midnight; `null` is unknown and `[]`
  is closed all week.

Full reference: `pnpm places docs filter`. The parser lives in
`@places/common/search`; edit `grammar.pegjs` then run
`pnpm --filter @places/common generate:search`.

## Data model

A place has a UUID (internal) and a unique Google Place ID (provider). Each
place carries `coordinates`, `name`, `address`, `timeZone`,
`businessStatus`, `googleMetadata`, `hoursWeeklyOpen`, and `lastSync`, plus
`tags` and `sources` arrays.

A **source** records where you discovered a place (an Instagram post or a
Google Maps import). A place can have multiple sources, so you can revisit
every recommendation.

## Instagram ingestion

Pasting an Instagram URL queues a job keyed by the post's shortcode. It
skips existing sources, scrapes the media, captures the places it mentions,
and atomically saves the source plus a batch of Google import jobs. Local
workers need `ffmpeg`/`ffprobe` on `PATH`.

```yaml
instagram:
  openai: { key: ... }
  alwaysApplyTags: []       # combined with captured tags on creation
  excludedTags: []          # extra exclusions
  excludedNamespaces: []    # exclude groups (e.g. personal ratings)
  requiredNamespaces: []    # require a classification (e.g. type.cafe)
```

## Background jobs

pg-boss runs two queues: `gmaps-import` and `gmaps-sync`. Configure per-queue
throughput:

```yaml
workers:
  gmaps-import: { batchSize: 1, concurrency: 1 }
  gmaps-sync: { batchSize: 1, concurrency: 1 }
```

`concurrency` is the number of polling workers per queue per process; each
claims up to `batchSize` jobs. Restart the worker after changing these.

## HTTP API

- `/rpc` — typed oRPC API.
- `/mcp` — Streamable HTTP MCP for agents.
- `/health` — health check.
- `/api/imports` — `POST` a `{"url": ...}` to import, `GET /api/imports/ID`
  to poll for `state`, `placeIds`, `placeNames`, `error`, and `sourceId`.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Set `TEST_DATABASE_URL` to a PostGIS instance to run database integration
tests. CLI integration tests bind ports 15188–15191.

## Container

```bash
podman build -t places .
podman run --rm -v /etc/places.yaml:/etc/places.yaml:ro \
  ghcr.io/evanpurkhiser/places:latest          # server (runs migrations first)
```

Other commands from the image: `migrate`, `worker`. Mount the YAML config
read-only at `/etc/places.yaml`; PostgreSQL + PostGIS runs separately.
Pushes to `main` publish `ghcr.io/evanpurkhiser/places:latest`.

## More reading

`design/`: `PRODUCT_SPEC.md`, `search-grammar.md`, `filter-engine.md`,
`tech.md`, `sources.md`, `place-metadata.md`, `hours.md`, `time-values.md`,
`instagram-import.md`.

## License

MIT. See `LICENSE`.
