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
Use a development instance. The CLI integration test binds `127.0.0.1:15188`.

```sh
TEST_DATABASE_URL=postgres://places:places@127.0.0.1:5432/places pnpm test
```
