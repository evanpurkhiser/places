# Technology

## Selected direction

| Area            | Choice      | Role                                                 |
| --------------- | ----------- | ---------------------------------------------------- |
| Language        | TypeScript  | Server, CLI, web, and shared contracts               |
| Workspace       | pnpm        | Manage apps and shared packages                      |
| Testing         | Vitest      | Unit and integration tests across workspace packages |
| Validation      | Zod         | Runtime schemas and inferred TypeScript types        |
| Database access | Drizzle     | Table definitions and typed queries                  |
| Migrations      | Drizzle Kit | Manage database schema migrations                    |
| Initial access  | Tailscale   | Restrict access to the tailnet                       |
| API             | oRPC        | API contracts, server procedures, and typed clients  |
| HTTP framework  | Hono        | HTTP middleware and hosting oRPC handlers            |

## Workspace

- `apps/cli`: command-line client of the server API.
- `apps/server`: API implementation, business logic, database access, and place-provider integration.
- `apps/web`: map interface and API client.
- `packages/common`: shared API contracts, Zod schemas, and inferred types.
- `design`: product and technical documents, plus the map interaction prototype.

## Schema and API direction

Use shared Zod schemas to describe API inputs and outputs. Infer TypeScript types
from those schemas. The server validates requests at the API boundary; the CLI
and web can reuse schemas for local input validation.

Use oRPC's contract-first approach to describe operations in `common` and implement
them in `server`. The CLI and web consume typed clients based on that contract.
OpenAPI support provides a path for documenting HTTP endpoints for external tools.

Drizzle table definitions and database migrations belong to the server. API schemas
represent client-facing operations and responses, including related tags and user
context. Drizzle's Zod helpers can derive validators where a table's shape matches
what an operation needs.

## Testing and build tooling

Use Vitest for unit and integration tests across the server, CLI, web, and shared
packages. Vitest can run with its own configuration for packages that use other
build tools.

Vite is the proposed development server and production build tool for `apps/web`.
Server, CLI, and shared-package build tooling remains open. Run TypeScript type
checking separately from Vite's transpilation and the test suite.

## Migrations

Use Drizzle Kit for database migrations. Keep migration files alongside the
server's Drizzle table definitions in `apps/server`.

## Access

The initial service is accessible through Tailscale, with the tailnet providing
the access boundary. Application authentication is deferred for this phase.

A public interface may be added later. Its exposed operations and authentication
requirements will be decided as part of that work.

## HTTP server

Use Hono in `apps/server` to host oRPC through its Fetch API adapter. Hono handles
HTTP middleware, CORS, request logging, and health checks. oRPC owns place and tag
operations, contract validation with Zod, typed errors, and API client integration.

Hono provides a small HTTP layer around the shared API contract and a familiar
middleware model for server-wide concerns.

## Validation interoperability

[Standard Schema](https://standardschema.dev/schema) defines a common interface for
TypeScript validation libraries. Zod implements it, and oRPC accepts Zod schemas
through that interface. OpenAPI generation uses a Zod-to-JSON-Schema converter.

## Open decisions

- Database engine and driver; PostgreSQL is a candidate.
- Drizzle and oRPC release versions, including whether to use prereleases.
- Deployment and migration execution workflow.
- Confirm Vite for the web and choose server, CLI, and shared-package build tooling.
- API transport configuration.
- Concrete place and tag contracts, including CLI command behavior.

## References

- [Vitest](https://vitest.dev/guide/)
- [Vite](https://vite.dev/guide/)
- [Hono](https://hono.dev/docs)
- [oRPC Hono integration](https://orpc.dev/docs/adapters/hono)
- [Zod](https://zod.dev/)
- [Drizzle](https://orm.drizzle.team/docs/overview)
- [Drizzle Zod integration](https://orm.drizzle.team/docs/zod)
- [oRPC contract-first guide](https://orpc.dev/docs/contract-first)
- [oRPC Zod integration](https://orpc.dev/docs/integrations/zod)
