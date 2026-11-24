# Places

A personal, self-hosted tool for saving, organizing, and mapping places,
built around **tags** instead of lists.
Save a place from a Google Maps link, a `gmaps:` ID, or an Instagram post,
tag it, then find it again by intent
("cafes open now within a mile") and see it on a map.

List-based saved-places tools break down as a collection grows: saving is easy,
retrieval is hard, filtering is limited, and lists sprawl.
Places makes filtering and sorting the core feature
and replaces lists with tags.

It is API-first: the CLI
and web UI are clients of the same typed contract everything else uses,
so scripts and AI agents can read and write your collection too.

## Quick start

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

See [Getting started](docs/getting-started.md) for the full setup.

## Workspace

- `packages/server` — API, database, and background jobs.
- `packages/cli` — the `places` command.
- `packages/web` — the map UI.
- `packages/common` — shared contracts and the query/filter engine.
- `design/` — product and technical specs.

Stack: Node 24, PostgreSQL + PostGIS, Drizzle, pg-boss, oRPC + Hono, Zod,
Vitest, React + MapLibre.
Access is via Tailscale.

## Documentation

- [Getting started](docs/getting-started.md) — prerequisites, setup,
  and configuration.
- [CLI](docs/cli.md) — command-line reference.
- [Query language](docs/query-language.md) — filters and search syntax.
- [Concepts](docs/concepts.md) — places, tags, namespaces, and sources.
- [Operations](docs/operations.md) — background jobs, sync, Instagram,
  and the HTTP API.
- [Deployment](docs/deployment.md) — containers and development.

## License

MIT.
See `LICENSE`.
