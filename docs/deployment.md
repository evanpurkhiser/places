# Deployment

## Development

```bash
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
```

Set `TEST_DATABASE_URL` to a PostGIS instance to run database integration
tests. CLI integration tests bind ports 15188–15191.

## Container

```bash
podman build -t places .
podman run --rm -v /etc/places.yaml:/etc/places.yaml:ro \
  ghcr.io/evanpurkhiser/places:latest          # server (runs migrations first)
```

Other commands from the image: `migrate`, `worker`. Mount the YAML config
read-only at `/etc/places.yaml`; PostgreSQL + PostGIS runs separately. Pushes
to `main` publish `ghcr.io/evanpurkhiser/places:latest`.
