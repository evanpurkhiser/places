# Technology

## Selected direction

| Area            | Choice      | Role                                                 |
| --------------- | ----------- | ---------------------------------------------------- |
| Language        | TypeScript  | Server, CLI, web, and shared contracts               |
| Workspace       | pnpm        | Manage apps and shared packages                      |
| Testing         | Vitest      | Unit and integration tests across workspace packages |
| Validation      | Zod         | Runtime schemas and inferred TypeScript types        |
| Database        | PostgreSQL  | Relational storage and JSONB source data             |
| Database access | Drizzle     | Table definitions and typed queries                  |
| Migrations      | Drizzle Kit | Manage database schema migrations                    |
| Background jobs | pg-boss     | PostgreSQL-backed queues, retries, and scheduling    |
| Initial access  | Tailscale   | Restrict access to the tailnet                       |
| API             | oRPC        | API contracts, server procedures, and typed clients  |
| HTTP framework  | Hono        | HTTP middleware and hosting oRPC handlers            |
| CLI parsing     | Optique     | Typed arguments, options, and subcommands            |
| Configuration   | YAML + Zod  | File-based settings validated at process startup     |

## Spatial storage

Use PostGIS `geography(Point, 4326)` for place coordinates with a GiST spatial
index. See [Place metadata](place-metadata.md) for the initial fields and planned
coordinate representation.

## Dependency baseline

Use the stable Drizzle ORM 0.45, Drizzle Kit 0.31, and oRPC 1.15 release
lines with Zod 4. Keep oRPC packages on matching versions. The pnpm lockfile
records resolved dependency versions.

## Workspace

- `packages/cli`: command-line client of the server API.
- `packages/server`: API implementation, business logic, database access, and place-provider integration.
- `packages/web`: map interface and API client.
- `packages/common`: shared API contracts, Zod schemas, and inferred types.
- `design`: product and technical documents, plus the map interaction prototype.

## Schema and API direction

Use shared Zod schemas to describe API inputs and outputs. Infer TypeScript types
from those schemas. The server validates requests at the API boundary; the CLI
and web can reuse schemas for local input validation.

Use oRPC's contract-first approach to describe operations in `common` and implement
them in `server`. The CLI and web consume typed clients based on that contract.

Export the assembled contract and client type from `@places/common/contract`.
Keep domain schemas and contracts in modules such as `@places/common/contract/tag`;
consumers reuse individual fields through the schema's `shape`.

Drizzle table definitions and database migrations belong to the server. API schemas
represent client-facing operations and responses, including related tags and user
context. Drizzle's Zod helpers can derive validators where a table's shape matches
what an operation needs.

## CLI argument parsing

Use Optique in `packages/cli` to define arguments, options, and subcommands with
inferred TypeScript types. Compose parsers to describe each command's accepted
inputs and generate help text.

Use Optique's Zod integration where argument values can reuse shared validators.
Command handlers call the server through the typed oRPC client.

## Testing and build tooling

Use Vitest for unit and integration tests across the server, CLI, web, and shared
packages. Vitest can run with its own configuration for packages that use other
build tools.

Vite is the proposed development server and production build tool for `packages/web`.
The initial server and CLI run TypeScript source directly on Node 24 using its
type stripping support. Shared contracts export TypeScript source within the
workspace. Run `tsc --noEmit` separately for type checking. Distribution build
tooling remains open.

## Configuration

Server settings live in a YAML file validated by a Zod schema at startup. The
schema defines defaults and rejects unknown keys. Commit an example configuration
and keep the actual configuration outside version control. Server and migration
commands accept `--config` to select the file; the CLI accepts `--server` for the
API URL.

Config fields carry Zod descriptions. Pass the validated config and database to
`createApp` and expose them through typed Hono and oRPC contexts.

## Database connection

Use node-postgres (`pg`) with Drizzle's node-postgres adapter. Create a connection
pool at startup and provide the database through oRPC context. Tag handlers issue
Drizzle queries directly.

## Migrations

Use Drizzle Kit for database migrations. Keep migration files alongside the
server's Drizzle table definitions in `packages/server`.

Apply reviewed migrations explicitly with `pnpm --filter @places/server
db:migrate`, using the server's YAML configuration.

## Access

The initial service is accessible through Tailscale, with the tailnet providing
the access boundary. Application authentication is deferred for this phase.

A public interface may be added later. Its exposed operations and authentication
requirements will be decided as part of that work.

## HTTP server

Use Hono in `packages/server` to host oRPC through its Fetch API adapter. Hono handles
HTTP middleware, CORS, request logging, and health checks. oRPC owns place and tag
operations, contract validation with Zod, typed errors, and API client integration.

Hono provides a small HTTP layer around the shared API contract and a familiar
middleware model for server-wide concerns.

Serve typed RPC at `/rpc`. Tag operations are
create, list, get, update, and delete; the CLI exposes them under `places tags`.

## Background jobs

Use pg-boss for Instagram extraction, imports, and eligible metadata refreshes.
Run workers as a separate process from the HTTP server, initially sharing business
logic and database code within `packages/server`.

Create a pg-boss instance at process startup and stop it during graceful shutdown.
Expose a typed jobs interface through oRPC context. Hono context can also carry
that interface when HTTP middleware or routes need it.

Define job payloads with Zod and use a small helper to associate each queue name
with its schema. Validate payloads when enqueueing and when workers receive them.
Keep job definitions shared between producers and consumers.

Use pg-boss's `fromDrizzle(tx, sql)` adapter to enqueue jobs inside the same
transaction as related application writes. Saving a source and scheduling its
extraction should commit or roll back together. pg-boss manages its own queue
tables and migrations; Drizzle Kit manages the application schema.

Make handlers safe to retry. Reprocessing a source should reuse canonical places
and source associations. Database transaction atomicity covers local writes;
external API calls and other side effects need their own retry handling.

## Validation interoperability

[Standard Schema](https://standardschema.dev/schema) defines a common interface for
TypeScript validation libraries. Zod implements it, and oRPC accepts Zod schemas
through that interface.

## Open decisions

- Deployment and migration execution workflow.
- Confirm Vite for the web and choose distribution build tooling.
- Concrete place contracts and CLI commands.
- pg-boss version, worker concurrency, retry policies, and job-status API.

## References

- [Optique](https://optique.dev/)
- [Optique Zod integration](https://optique.dev/integrations/zod)
- [pg-boss](https://pgboss.io/)
- [pg-boss Drizzle transaction adapter](https://pgboss.io/api/adapters)
- [Vitest](https://vitest.dev/guide/)
- [Vite](https://vite.dev/guide/)
- [Hono](https://hono.dev/docs)
- [oRPC Hono integration](https://orpc.dev/docs/adapters/hono)
- [Zod](https://zod.dev/)
- [Drizzle](https://orm.drizzle.team/docs/overview)
- [Drizzle Zod integration](https://orm.drizzle.team/docs/zod)
- [oRPC contract-first guide](https://orpc.dev/docs/contract-first)
- [oRPC Zod integration](https://orpc.dev/docs/integrations/zod)
