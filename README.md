# Personal Map

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
pnpm places tags create 'type:cafe'
pnpm places tags create 'type:bar' --icon '🍸' --description 'Primarily visited for drinks'
pnpm places tags list
pnpm places tags get <id>
pnpm places tags update <id> 'type:coffee'
pnpm places tags update <id> --icon '☕' --description 'Cafe or coffee shop'
pnpm places tags update <id> --icon '' --description ''
pnpm places tags delete <id>
```

Use `--server https://5188.prk.network` to override the CLI's default local server.
Commands print JSON to stdout, errors to stderr, and exit nonzero on failure.
Run `pnpm places --help` for argument help.

The CLI and web use typed oRPC calls at `/rpc`. Shared contracts are available
from `@places/common/contract` and tag schemas from `@places/common/contract/tag`.

Names are trimmed and lowercased. Empty names are rejected; duplicate names return
409, and missing IDs return 404. Listing returns all tags sorted by name. Renaming
preserves the tag ID and place associations; deleting removes those associations
while preserving places. Create, get, update, and delete return the tag record.

Create and update accept `--icon EMOJI` and `--description TEXT`. Update accepts
an optional name and preserves omitted fields. Pass an empty string with
`--icon ''` or `--description ''` to set that field to null. Updates require
at least one change.

## Place tags

Apply existing tags to saved places using the place UUID from `list` or
`import-status` and a tag name or UUID:

```sh
pnpm places tag <place-id> attr:nice-bathroom
pnpm places tag <place-id> attr:nice-bathroom --notes 'Code 1234'
pnpm places tag <place-id> attr:nice-bathroom --notes ''
pnpm places untag <place-id> attr:nice-bathroom
```

`tag` ensures the assignment exists and returns it, including its note. Omitted
`--notes` preserves the current note; supplied text replaces it, and an empty
string clears it. `untag` removes the assignment and its note, preserving the
place and shared tag definition. Its `removed` result is false when the tag was
already unassigned. Both commands report an error for an unknown place or tag.

## Google Maps imports

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
pnpm places import 'gmaps:ChIJ...'
pnpm places import 'gmaps:ChIJ...' --tag type:cafe --tag <tag-id>
pnpm places import 'gmaps:ChIJ...' --notes 'Try the espresso tonic'
pnpm places import 'gmaps:ChIJ...' --tag-note attr:nice-bathroom 'Code 1234'
pnpm places import-status <job-id>
pnpm places list
```

Repeat `--tag NAME_OR_ID` to apply existing tags by name or UUID. Names are trimmed
and lowercased. Unknown tags are rejected before queuing. Tags are added to new
and existing places; repeated tags are applied once.

Use `--notes TEXT` to save notes with a place. On reimport, supplied notes replace
the saved note; omitting the option preserves it. Use `--notes ''` to clear it.

Use `--tag-note NAME_OR_ID NOTE` to apply an existing tag and save a note on its
assignment to the place. Repeat the option for multiple tags. Supplied notes
replace existing assignment notes; an empty string clears the note while keeping
the tag. Omitting a tag note, including when using plain `--tag`, preserves it.
If multiple notes resolve to the same tag, the last note wins. Tag names are
normalized; note text is preserved verbatim. `--notes` stores the place's general
note independently.

Import resolves the input to a Google Place ID in the RPC request and returns a
job ID and provider type (`gmaps`). Import status returns the resulting place IDs.
The worker fetches name, formatted address, Maps URL, and coordinates,
then inserts the complete place. Existing places are reused. Failed attempts
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
Use a development instance. CLI integration tests bind `127.0.0.1:15188` and
`127.0.0.1:15189`.

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
