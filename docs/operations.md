# Operations

## Background jobs

pg-boss runs three queues: `instagram-import`, `gmaps-import`, and `gmaps-sync`.
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

## Instagram ingestion

Pasting an Instagram URL queues a job keyed by the post's shortcode.
It skips existing sources, scrapes the media, captures the places it mentions,
and atomically saves the source plus a batch of Google import jobs.
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

Use `social-posts` for shared capture and tagging defaults.
The `instagram` section supplies provider-specific overrides.
Capture fields are inherited individually.
Each list is replaced as a whole, and `[]` clears an inherited list.

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
