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
pnpm places tags list
pnpm places tags get <id>
pnpm places tags update <id> 'type:coffee'
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
pnpm places import-status <job-id>
pnpm places list
```

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
