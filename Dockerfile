FROM debian:stable-slim AS base

RUN apt-get update \
  && apt-get install -y curl gnupg libatomic1 ca-certificates xz-utils ffmpeg --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

ENV MISE_DATA_DIR=/mise
ENV MISE_CONFIG_DIR=/mise
ENV MISE_CACHE_DIR=/mise/cache
ENV MISE_INSTALL_PATH=/usr/local/bin/mise
ENV PATH=/mise/shims:$PATH

RUN curl -fsSL https://mise.run -o /tmp/install-mise.sh \
  && sh /tmp/install-mise.sh \
  && rm /tmp/install-mise.sh

WORKDIR /app
COPY mise.toml ./
RUN mise trust mise.toml && mise install node pnpm

FROM base AS web-build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/web/package.json ./packages/web/
COPY packages/common/package.json ./packages/common/
RUN pnpm --filter places --filter @places/web... install --frozen-lockfile

COPY packages/common/src/ ./packages/common/src/
COPY packages/web/index.html packages/web/tsconfig.json packages/web/vite.config.ts ./packages/web/
COPY packages/web/src/ ./packages/web/src/
RUN pnpm --filter @places/web build

FROM base AS runtime

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json ./packages/server/
COPY packages/common/package.json ./packages/common/
RUN pnpm --filter @places/server... install --prod --frozen-lockfile

# Keep workspace sources outside node_modules for Node's native TypeScript support.
COPY packages/common/src/ ./packages/common/src/
COPY packages/server/src/ ./packages/server/src/
COPY packages/server/drizzle/ ./packages/server/drizzle/
COPY --from=web-build /app/packages/web/dist/ ./packages/web/dist/
COPY dockerStart.sh ./

ENV NODE_ENV=production
WORKDIR /app/packages/server
EXPOSE 5188

ENTRYPOINT ["/app/dockerStart.sh"]
CMD ["server"]
