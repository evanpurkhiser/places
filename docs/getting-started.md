# Getting started

## Prerequisites

- Node 24 and pnpm (see `mise.toml` for the pinned versions).
- PostgreSQL with the PostGIS extension available.
- A Google Cloud project with the Places API (New) enabled, for imports and
  place-name resolution.
- An OpenAI API key, for Instagram ingestion.
- `ffmpeg` and `ffprobe` on `PATH`, for the Instagram worker.

## Install

```bash
mise trust && mise install
pnpm install
prek install
```

Verify the workspace:

```bash
pnpm lint
pnpm format:check
```

## Configure

Copy the example config and fill in your database URL and Google API key:

```bash
cp packages/server/config.example.yaml packages/server/config.yaml
```

The file is Git-ignored and validated with Zod at startup; unknown keys are
rejected. The `server`, `worker`, and `db:migrate` commands accept
`--config /absolute/path/to/config.yaml`.

### Configuration reference

```yaml
server:
  host: 127.0.0.1
  port: 5188

database:
  url: postgres://places:places@127.0.0.1:5432/places

# Required for importing places and running the worker.
google:
  apiKey: your-google-places-api-key

# Required for Instagram ingestion.
openai:
  key: your-openai-api-key

# Per-queue settings; jobs in a batch run concurrently.
workers:
  instagram-import:
    batchSize: 1
    concurrency: 1
  gmaps-import:
    batchSize: 1
    concurrency: 1
  gmaps-sync:
    batchSize: 1
    concurrency: 1

# Instagram capture and tagging rules. Automatic tags must already exist.
instagram:
  alwaysApplyTags: [status.needs-review]
  excludedTags: [favorite]
  excludedNamespaces: [rating]
  requiredNamespaces: [type]
  capture:
    model: gpt-5.6-luna
    reasoningEffort: medium
    instructions: Assign a type and evidence-supported atmosphere tags.
```

## Run

```bash
pnpm --filter @places/server db:migrate
pnpm server     # API on 127.0.0.1:5188
pnpm worker     # background jobs (separate process)
pnpm web        # map at http://127.0.0.1:5187
```

The initial migration enables PostGIS, so the migration role needs permission
to install that extension.

## Next steps

- [Use the CLI](cli.md).
- [Learn the query language](query-language.md).
