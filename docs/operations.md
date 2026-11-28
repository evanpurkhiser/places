# Operations

## Background jobs

pg-boss runs `instagram-import`, `rednote-import`, `gmaps-import`,
and `gmaps-sync`.
Workers run as a separate process:

```bash
pnpm server    # HTTP API
pnpm worker    # background jobs
```

Per-queue throughput is configured in the server YAML:

```yaml
workers:
  instagram-import:
    batchSize: 1
    concurrency: 1
  rednote-import:
    batchSize: 1
    concurrency: 1
  gmaps-import:
    batchSize: 1
    concurrency: 1
  gmaps-sync:
    batchSize: 1
    concurrency: 1
```

`concurrency` is the number of polling workers per queue per process;
each claims up to `batchSize` jobs.
Restart the worker after changing these.

## Sync

```bash
pnpm places sync
pnpm places sync --query 'tag[type.cafe]'
pnpm places sync-status JOB_ID
```

Sync queues a Google metadata refresh for each matching place.
The response reports `matched`, `queued`, `alreadyQueued`, and `jobIds`;
status ends as `updated`, `unchanged`, `missing`, or `superseded`.

## Media ingestion

Pasting an Instagram URL queues a job keyed by the post's shortcode.
A RedNote note or share link queues a job that resolves to the note ID.
Both workers skip existing sources, fetch the media,
capture the places the post mentions,
and atomically save the source plus a batch of Google import jobs.
The worker needs `ffmpeg` and `ffprobe` on `PATH`.

```yaml
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

To enable RedNote imports,
add a separate `rednote` section with its own capture and tagging settings.
For notes that require a share token, use a fresh link copied from the app.

The OpenAI key lives at the top level, shared by model integrations:

```yaml
openai:
  key: your-openai-api-key
```

## HTTP API

- `/rpc` — typed oRPC API.
- `/mcp` — Streamable HTTP MCP for agents.
- `/health` — health check.
- `/api/imports` — `POST` a `{"url": ...}` to get a `jobId` and `importType`.
  Poll `GET /api/imports/ID` for `state`, `importType`, `placeIds`,
  `placeNames`, `error`, and `sourceId`.
