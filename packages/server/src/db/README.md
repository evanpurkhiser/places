# Database schema

`schema.ts` defines the initial five-table model. Database IDs are UUIDs; TypeScript
properties use camelCase and PostgreSQL columns use snake_case.

- Deleting a place, tag, or source cascades to its join-table associations.
- Deleting a place preserves its source and tag records.
- Source types and JSON payloads remain open-ended pending capture contracts.
- Tag names must be nonempty, lowercase, and trimmed; normalize inputs before writing.
- `updated_at` is maintained by Drizzle's `$onUpdate` for Drizzle updates. Direct
  SQL writers must set it explicitly.

## PostGIS

Coordinates use `geography(Point, 4326)` and a GiST index. The custom type accepts
PostGIS text input, such as `SRID=4326;POINT(-73.9876 40.7292)`, and returns the
provider's hex EWKB representation. Driver integration will add the API projection
to named latitude and longitude values.

The initial migration enables PostGIS with
`CREATE EXTENSION IF NOT EXISTS postgis;` before creating the places table.
Drizzle Kit 0.31.10 quotes the entire custom geography type when generating SQL.
Review generated SQL and change `"geography(Point, 4326)"` to
`geography(Point, 4326)` before applying it. This correction is needed whenever a
migration emits that type. Use reviewed migration files for schema changes.

## Review

From the server package:

```sh
pnpm typecheck
pnpm db:generate
pnpm db:migrate
```

Generation requires no database connection. Migration execution uses node-postgres
and reads the database URL from the server's YAML config. Pass `--config` to select
a config file. Provider metadata retention remains subject to the design in
`design/place-metadata.md` at the repository root.
