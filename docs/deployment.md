# Deployment

## Development

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Set `TEST_DATABASE_URL` to a PostGIS instance to run database integration tests.
CLI integration tests bind ports 15188–15191.

## Container

```bash
podman build -t places .
podman run --rm -v /etc/places.yaml:/etc/places.yaml:ro \
  ghcr.io/evanpurkhiser/places:latest          # server (runs migrations first)
```

Other commands from the image: `migrate`, `worker`.
Mount the YAML config read-only at `/etc/places.yaml`;
PostgreSQL + PostGIS runs separately.
Pushes to `main` publish `ghcr.io/evanpurkhiser/places:latest`.

## User management

Run the user commands from a root shell on the production server.
`list` reports each user's UUID and whether the user is the default.
Requests without an authorization header use the default user.

```bash
podman exec places-server /app/dockerStart.sh users list
podman exec places-server /app/dockerStart.sh users rename USER_ID evan
podman exec places-server /app/dockerStart.sh users create vivian
podman exec places-server /app/dockerStart.sh users rotate-token USER_ID
podman exec places-server /app/dockerStart.sh users revoke-token USER_ID
```

For a development database,
use `pnpm --filter @places/server users --config PATH COMMAND`.
`rotate-token` prints the new bearer token once and replaces any previous token.
Store it in the client's credential store or token file.
Revoking a token preserves the user and existing attribution.
