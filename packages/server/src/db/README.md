# Database schema

`schema.ts` defines places, tags, sources, their associations, and import runs.
Database IDs are UUIDs; TypeScript properties use camelCase and PostgreSQL columns
use snake_case.

- Deleting a place, tag, or source cascades to its join-table associations.
- Deleting a place preserves its source and tag records.
- Sources have a nullable `external_id`, unique within each source `type`.
  Multiple sources without an external ID are allowed.
- The shared Zod source contract validates `data` according to `type`; Instagram
  metadata includes caption, username, UTC post timestamp, and thumbnail URL.
  Drizzle's `$type` annotations provide static typing. Application boundaries
  must parse the full source with Zod to enforce the type/payload relationship;
  PostgreSQL stores JSONB without enforcing the Zod contract.
- Namespaces have unique, nonempty, lowercase, trimmed names without colons,
  optional descriptions, and icons in the tag icon format.
- Tags have a nullable `namespace_id` referencing namespaces; deleting a namespace
  containing tags is restricted.
- Tags store globally unique qualified names (`type:cafe`). Names are lowercase
  and trimmed; namespaced tags have exactly one colon with nonempty parts.
- Application writes resolve and lock the namespace before writing a qualified
  tag name. Namespace renames rewrite member prefixes in the same transaction.
  Direct SQL writers must keep the prefix and `namespace_id` consistent.
- `updated_at` is maintained by Drizzle's `$onUpdate` for Drizzle updates. Direct
  SQL writers must set it explicitly.

## Weekly hours and sync

`places.time_zone` stores the IANA time zone. `hours_weekly_open` is a nullable
`int4multirange`, exposed as pairs of minute offsets from Sunday midnight.
A check constraint bounds intervals to `[0,10080)` and a GiST index supports
containment. Null means unknown; the empty multirange means known closed.
`business_status` stores the provider's closure status separately from hours.
`last_sync` advances after each successful Google refresh, including unchanged
results. Failed refreshes preserve the previous snapshot.

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

Migration `0005_namespaces` creates the namespace table. Migration
`0006_tag_namespaces` adds tag membership and qualified-name constraints.
For existing qualified tags, manually create their namespaces and backfill
`namespace_id` after adding the column and before applying the constraints.
Preserve tag names, IDs, and place associations during this conversion.

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

## Import runs

`import_runs` retains Instagram and Google import executions independently of queue
retention. Its UUID is the queue job ID. Queue retries increment `attempts` on the
same record; a separately queued request gets a new record. `source_id` links the
Instagram run and its Google place jobs to their source. It is nullable for failed
fetches and standalone Google imports. Deleting a source preserves its run history.

`input` contains the job payload. `output` contains the handler result; Instagram
capture results include source metadata, extracted places, unresolved mentions,
model settings, the assembled instruction prompt, Google search candidates, and model
token usage. Media files and model reasoning are not stored in the run record.
Capture output and its source link are saved in the same transaction as the source
and child jobs. Queue retries preserve that extraction in the run record.

Import status reads `import_runs` and aggregates the recorded child runs for Instagram
imports. Runs retain the last recorded worker state; queue-side cancellations
or timeouts can leave that state unfinished. The run records can be inspected directly
in PostgreSQL after queue cleanup.

Migration `0008_import_runs` creates the table. Runs are recorded when imports are
enqueued or begin execution. Status lookup requires a recorded run; historical
imports are not automatically backfilled.
