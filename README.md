# Places

A personal saved-places service organized around tags.

## Workspace

- `packages/cli` — command-line client
- `packages/server` — API and persistence
- `packages/web` — map interface
- `packages/common` — shared schemas and types
- `design` — product specs and map interaction prototype

## Setup

```sh
mise trust
mise install
pnpm install
prek install
```

Run `pnpm lint` and `pnpm format:check` to check the workspace.

## Tag API and CLI

Use Node 24 and a PostgreSQL database with PostGIS available. From the repository
root, copy `packages/server/config.example.yaml` to `packages/server/config.yaml` and set
the database URL. The local config is ignored by Git and validated with Zod.

```sh
pnpm --filter @places/server db:migrate
pnpm server
```

Both commands accept `--config /absolute/path/to/config.yaml`. The initial
migration enables PostGIS; the migration role needs permission to install that
extension. The server defaults to `127.0.0.1:5188`, available on the tailnet at
`https://5188.prk.network`.

```sh
pnpm places ns create type
pnpm places tags create 'type.cafe'
pnpm places tags create 'type.bar' --icon '🍸' --description 'Primarily visited for drinks'
pnpm places tags list
pnpm places tags get <id>
pnpm places tags update <id> 'type.coffee'
pnpm places tags update <id> --icon '☕' --description 'Cafe or coffee shop'
pnpm places tags update <id> --icon '' --description ''
pnpm places tags delete <id>
```

The CLI reads `~/.config/places/config.yaml` (or
`$XDG_CONFIG_HOME/places/config.yaml` when set):

```yaml
server: https://5188.prk.network
```

Use `--config PATH` to select another CLI config and `--server URL` to override
the configured server. With no config file, the CLI defaults to
`http://127.0.0.1:5188`. Explicit config paths must exist; invalid configs report
an error.
Data commands print JSON and documentation commands print text to stdout. Errors
print to stderr, with a nonzero exit status on failure.
Run `pnpm places --help` for argument help.

To install the CLI globally from this checkout, run from the repository root:

```sh
pnpm add -g ./packages/cli --global-bin-dir="$HOME/.local/bin"
places --help
```

Ensure `~/.local/bin` is on your PATH and Node 24 is available outside the
repository. The command uses this checkout and its installed dependencies, so
source edits take effect immediately. Keep the checkout in place and run
`pnpm install` when dependencies change.

The CLI and web use typed oRPC calls at `/rpc`. Shared contracts are available
from `@places/common/contract` and tag schemas from `@places/common/contract/tag`.

Tag names are stored as globally unique qualified names, such as `type.cafe`,
and normalized by trimming and lowercasing. A qualified name has one dot and
nonempty, trimmed namespace and local-name parts. Bare names such as `favorite`
have a null `namespaceId`. Namespaces must exist before creating or renaming tags
into them; an unknown namespace returns 404. Duplicate names return 409.

Renaming a tag can move it to another namespace or to no namespace while
preserving its ID, metadata, and place associations. For example,
`places tags update <id> cuisine.coffee` moves it into an existing `cuisine`
namespace, and `places tags update <id> coffee` removes namespace membership.
Listing returns tags sorted by their qualified name. Deleting a tag removes its
place associations while preserving places.

Tags have an `archived` boolean, defaulting to false. Archived tags are omitted
from `tags list` and from the tags returned with places, while their assignments,
notes, names, and IDs remain available. Filters such as `tag[old-list]`, wildcard
patterns, and `has[tag]` still include archived tags. Direct lookup with
`tags get <id>` returns an archived tag. Archiving keeps the tag name reserved.

```sh
pnpm places tags update <id> --archive
pnpm places tags update <id> --unarchive
```

New tags start active. Restoring a tag makes it and its existing place assignments
visible in lists again.

Create and update accept `--icon EMOJI` and `--description TEXT`. Update accepts
an optional name and preserves omitted fields. Pass an empty string with
`--icon ''` or `--description ''` to set that field to null. Updates require
at least one change.

## Namespaces

Manage namespaces with `namespace` or its alias `ns`:

```sh
pnpm places namespace create type --icon '🏷️' --description 'What kind of establishment this is'
pnpm places ns list
pnpm places ns get <id>
pnpm places ns update <id> category
pnpm places ns update <id> --icon '📍' --description 'Place categories'
pnpm places ns update <id> --icon '' --description ''
pnpm places ns delete <id>
```

Namespace names are unique, trimmed, lowercase, and nonempty. Colons are reserved
as separators. Icons use the same `{emoji: string}` format as tags. Updates
preserve omitted fields and accept a name, icon, description, or a combination;
empty CLI metadata values clear those fields. Renaming preserves the UUID and
rewrites all member tags' prefixes in the same transaction. A namespace containing
tags requires `places ns delete <id> --force` to unlink its tags and strip their
namespace prefixes before deletion. Tag IDs, metadata, and place associations
are preserved. If any resulting bare name already exists, the command reports
a conflict and leaves the namespace and all tags unchanged.

The `namespaces` RPC exposes `list`, `get`, `create`, `update`, and `delete`.
Listing returns namespaces sorted by name; duplicate names return 409 and
missing IDs return 404. Schemas are exported from
`@places/common/contract/namespace`.

## Place tags

`places.list` includes a `tags` array on each place. Each association contains
`placeId`, `tagId`, `note`, `createdAt`, and the complete nested `tag` metadata
(including `name` and `icon`). Associations are ordered by tag name. Filtering by
a tag returns all associations on each matching place; untagged places have an
empty array.

Apply existing tags to saved places using the place UUID from `list` or
`import-status` and a tag name or UUID:

```sh
pnpm places tag <place-id> attr.nice-bathroom
pnpm places tag <place-id> attr.nice-bathroom --notes 'Code 1234'
pnpm places tag <place-id> attr.nice-bathroom --notes ''
pnpm places untag <place-id> attr.nice-bathroom
```

`tag` ensures the assignment exists and returns it, including its note. Omitted
`--notes` preserves the current note; supplied text replaces it, and an empty
string clears it. `untag` removes the assignment and its note, preserving the
place and shared tag definition. Its `removed` result is false when the tag was
already unassigned. Both commands report an error for an unknown place or tag.

## Place imports

Enable Places API (New) for your Google Cloud project and put the API key in the
ignored `packages/server/config.yaml`:

```yaml
google:
  apiKey: your-google-places-api-key
```

Run `pnpm server` and `pnpm worker` as separate processes using the same database
and config. The worker also accepts `--config /absolute/path/to/config.yaml`.
pg-boss creates and manages its own schema at startup.

```sh
pnpm places import 'https://maps.app.goo.gl/jbJWNK3airzeACCC7'
pnpm places search-gmaps 'coffee shops in East Village, NYC'
pnpm places import 'gmaps:ChIJ...'
pnpm places import 'gmaps:ChIJ...' --wait
pnpm places import 'https://www.instagram.com/p/SHORTCODE/' --wait --tag type.cafe
pnpm places import 'gmaps:ChIJ...' --tag type.cafe --tag <tag-id>
pnpm places import 'gmaps:ChIJ...' --notes 'Try the espresso tonic'
pnpm places import 'gmaps:ChIJ...' --tag-note attr.nice-bathroom 'Code 1234'
pnpm places import-status <job-id>
pnpm places list
```

Instagram post and reel URLs use the Instagram capture worker, which requires the
Instagram/OpenAI configuration. Each matched place is queued for Google import.
`import-status` and `--wait` track the complete operation and return all saved
place IDs. Status includes partial results while children run and reports failed
or cancelled children. A repeated post skips capture and follows retained child
jobs, including failures; after those jobs expire, it returns the source's saved
places. Queue history is retained for seven days after completion.

Repeat `--tag NAME_OR_ID` to apply existing tags by name or UUID. Names are trimmed
and lowercased. Unknown tags are rejected before queuing. Tags are applied when creating
a place; repeated tags are applied once.

Use `--notes TEXT` to save notes when creating a place. Reimporting an existing
place preserves its tags, tag notes, and place notes while attaching supplied sources.

Use `--tag-note NAME_OR_ID NOTE` to apply an existing tag and save a note on its
assignment when creating a place. Repeat the option for multiple tags. An empty
string or omitted note creates the assignment without a note.
If multiple notes resolve to the same tag, the last note wins. Tag names are
normalized; note text is preserved verbatim. `--notes` stores the place's general
note independently.

Import returns a job ID and provider type (`gmaps` or `instagram`). Google Maps
inputs resolve to a Google Place ID in the RPC request. Import status returns
the resulting place IDs.
With `--wait`, the CLI polls status once per second until completion and prints
`jobId`, `type`, `state`, `placeIds`, and `error` as JSON. Failed or cancelled jobs
exit nonzero. Waiting continues through retries; Ctrl-C stops waiting while the
queued job continues running.
The Google worker fetches name, formatted address, Maps URL, coordinates, time zone,
business status, and weekly hours, then inserts the place with `lastSync` set. Existing places are reused. Failed attempts
leave no partial place; pg-boss retries three times with backoff. Status comes
from pg-boss and is temporary (completed jobs are retained for seven days).

Supported URLs include `query_place_id`, `q=place_id:...`, `ftid`, and Maps
place links with identifiers in their `data=` payload, including Takeout exports.
Short links are expanded with validated redirects. Feature IDs are converted
locally to Place IDs using a reverse-engineered binary layout; the worker fetches
Place Details to validate them and populate metadata. Links must identify a
specific place; otherwise, supply `gmaps:<place_id>`.

The initial listing returns all saved places newest first, with named
`coordinates.latitude` and `coordinates.longitude`. Provider storage and map
display constraints are documented in [place metadata](design/place-metadata.md).

## Instagram ingestion worker

Configure the required `instagram` settings in the server YAML; see
[the example configuration](packages/server/config.example.yaml). Set `openai.key`,
the capture model and tagging rules, and `alwaysApplyTags` containing existing
tag names (or an empty list). These tags are combined with captured tags when
creating a place. Existing places keep their tags and notes while gaining the
source association. Automatic tags are excluded from model choices. Use
`excludedTags` for additional exclusions, `excludedNamespaces` to exclude groups
such as personal ratings, and `requiredNamespaces` to require a classification
such as `type.cafe` or `type.restaurant`. All four tagging lists live directly
under `instagram` and accept `[]`. For review before map display, include
`status.needs-review` in `alwaysApplyTags` and exclude it from map queries.

`enqueueInstagramImport(jobs, url)` queues an ingestion keyed by the Instagram
shortcode. The job skips existing sources, otherwise scrapes and prepares media,
captures recommendations, and atomically saves the source with a batch of Google
import jobs. Completion returns `sourceId`, child `jobIds`, unresolved mentions,
and whether ingestion was skipped. Child jobs import places independently;
Instagram job completion means capture and dispatch have finished.

The Instagram queue defaults to one worker with a batch size of one. Local
workers need `ffmpeg` and `ffprobe` on PATH; the container image includes them.
Thumbnail metadata contains Instagram's remote cover URL. CLI and public API
entry points for Instagram ingestion are planned.

## Sync Google place metadata

```sh
pnpm places sync
pnpm places sync --query 'tag[type.cafe]'
pnpm places sync-status <job-id>
```

Sync selects saved places using the same query syntax as `list` and queues one
job per place. With no query it selects all places. The response includes
`matched`, `queued`, `alreadyQueued`, and `jobIds`. Pending and active jobs are
deduplicated per place. Run the worker to process them; transient failures retry
three times with backoff. Sync status reports the queue state and an `updated`,
`unchanged`, `missing`, or `superseded` result after completion.

Worker throughput is configured per queue in the server YAML:

```yaml
workers:
  gmaps-import:
    batchSize: 1
    concurrency: 1
  gmaps-sync:
    batchSize: 1
    concurrency: 1
```

These are the defaults. `concurrency` is the number of polling workers for that
queue per process; each claims up to `batchSize` jobs and runs them concurrently.
The maximum number of in-flight jobs per queue per process is their product.
Every job retains its own result and retries independently of other batch members.
Restart the worker after changing configuration. Additional worker processes each
apply these limits independently.

Each job refreshes Google's place ID, name, address, Maps URL, coordinates, IANA time zone,
business status, and regular weekly hours. Notes, tags, and source associations
are preserved. `lastSync` records successful refreshes, including unchanged
results; `updatedAt` advances when saved metadata changes. Failed requests leave
saved data intact. A successful response with unavailable hours clears old hours.
Hours fields require Google's Place Details Enterprise tier. A refreshed Google ID
replaces the saved provider ID while preserving the internal UUID. If another
saved place owns that ID, the refresh fails atomically and preserves both places.

`list` includes nullable `timeZone`, `businessStatus`, `lastSync`, and
`hoursWeeklyOpen`. Hours are pairs of inclusive-start/exclusive-end minute offsets
from Sunday midnight, between 0 and 10,080. For example, Monday 09:00–12:00 is
`[[1980,2160]]`; 24/7 is `[[0,10080]]`. Null means unknown and an empty array means
known closed throughout the week. The `open` filter evaluates this saved weekly
schedule, which reflects the last sync and may differ on holidays.

## Search and filter engine

Discover the running server's supported filters, functions, value types, and examples:

```sh
pnpm places docs filter
```

The command renders documentation from `query.describe` as plain text. Parameter descriptions include
expected types, supported operators, and optionality. Filters indicate whether
`has[...]` can check their presence.

Filter saved places through the API or CLI:

```sh
pnpm places list --query 'tag[favorite] AND !tag[visited]'
pnpm places list --query 'tag[laptop-friendly, notes:outlet]'
pnpm places list --query '(name[coffee] OR tag[type.bakery]) !has[notes]'
pnpm places list --query 'location[radius("East Village, NY", 1mi)]'
pnpm places list --query 'open[@now, for:2h]'
pnpm places list --query 'open["mon 6pm", until:"tue 2am"]'
```

Supported filters are `tag`, `name`, `address`, `notes`, `has`, `location`, and `open`.
Tags support exact
names and wildcard patterns; `notes:` within a tag predicate matches that same
assignment's note. Exact unknown tags return errors, including under negation.
`has` supports filters that register a presence check: `tag`, `name`, `address`,
and `notes`.

`location` supports `radius(point(longitude, latitude), distance)` and
`rect(topLeft, bottomRight)`. Points also accept place names, addresses, and
`"gmaps:<place_id>"` strings and Google Maps place links. Names resolve through Google Places Text Search using
`google.apiKey`; include a city or region to guide the search. The first Google result
provides the origin point. Independent
lookups run concurrently, and repeated names share one lookup per query.
Radius distances support `m`, `km`, `ft`, and `mi`.

`open` accepts `@now`, clock times such as `6pm` or `22:00`, weekday times such
as `"MON 6pm"`, and ISO timestamps such as `"2026-09-21T18:00:00-04:00"`.
Clock times mean today in each place's time zone. Add `for:2h` or an `until:`
endpoint to require continuous opening. Duration units are `m` and `h`.
Missing hours remain unknown under negation, so `!open[@now]` selects known-closed
places. See [time values](design/time-values.md) for interval and time-zone rules.

Listing accepts an optional query and returns the existing array of places, newest
first. Query failures print JSON diagnostics with source locations to stderr and
exit nonzero. Area boundaries and saved-query filters require future server
implementations.

The shared package exports a PEG-based query parser at `@places/common/search`:

```ts
import {parseQuery} from '@places/common/search';

const query = parseQuery(
  'tag[laptop-friendly, notes:outlet] location[radius(@home, 1mi)]',
);
```

The parser returns a syntax tree with source locations. The filter engine's
`prepare(input)` validates the complete query against registered filter and
function signatures. Registrations declare accepted argument types, operators,
and constraints. Syntax and semantic errors throw `SearchError` with structured
diagnostics.

`@places/common/filter-engine` owns validation and resolution; server registrations
produce Drizzle SQL predicates. See
[Search grammar](design/search-grammar.md) for the language and
[Filter engine](design/filter-engine.md) for the registration and execution layers.

After editing `packages/common/src/search/grammar.pegjs`, run
`pnpm --filter @places/common generate:search`. The generated parser ships with the sources;
tests check that it matches the grammar. Generation uses
[Peggy](https://peggyjs.org/documentation.html).

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Database integration tests run when `TEST_DATABASE_URL` points to a PostgreSQL
instance with PostGIS available. They create and drop a separate randomly named
database; the supplied role needs database creation and extension permissions.
Use a development instance. CLI integration tests bind `127.0.0.1` on ports
15188, 15189, 15190, and 15191.

```sh
TEST_DATABASE_URL=postgres://places:places@127.0.0.1:5432/places pnpm test
```

## Container

The image runs Node directly with production dependencies and the shared workspace
contracts. Build it locally with `podman build -t places .` (Docker also works).
The lint workflow runs prek, including lint and formatting. The build workflow
runs typechecking and tests against PostGIS before building the image. Both run
on pull requests and pushes to `main`. Pushes to `main` publish
`ghcr.io/evanpurkhiser/places:latest` through the shared Docker workflow; pull
requests build without publishing. The shared workflow builds Linux amd64.

Mount a YAML config at `/etc/places.yaml` read-only. Use the same config for the
server, worker, and migration command. For containers on a shared network:

```yaml
server:
  host: 0.0.0.0
  port: 5188
database:
  url: postgres://places:password@postgres:5432/places
google:
  apiKey: your-google-places-api-key
```

PostgreSQL with PostGIS runs separately. The database hostname must be reachable
from the containers. Within a Podman pod, use `127.0.0.1` for PostgreSQL; the
containers share a network namespace. Publish the HTTP port on host loopback.
Keep the config readable only by the service account and mount it into each
container. Application containers keep their persistent state in PostgreSQL.

The default `server` command runs database migrations before starting the HTTP
server. If a migration fails, the container exits. Start or update the server
before the worker so the database schema is ready. To run migrations separately:

```sh
podman run --rm --network places -v /etc/places.yaml:/etc/places.yaml:ro \
  ghcr.io/evanpurkhiser/places:latest migrate
```

Use the default `server` command for the HTTP container and `worker` for a second
container from the same image. Both support `--config PATH` to select another
mounted config. Node receives container stop signals directly. `/health` serves
the HTTP health check. Ansible can manage the PostgreSQL volume, pod, config,
service units, and image updates using the existing registry auto-update pattern.
