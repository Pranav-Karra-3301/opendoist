# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @opentask/web build
RUN pnpm --filter opentask build
RUN pnpm --filter @opentask/server --prod deploy /out/server

FROM node:22-alpine AS runtime
RUN apk add --no-cache wget
WORKDIR /app
COPY --from=build /out/server ./server
COPY --from=build /app/apps/web/dist ./web-dist
# OpenTask CLI: `docker exec <container> opentask …` (ot = short alias; legacy opendoist/od kept)
COPY --from=build /app/packages/cli/dist/index.js /usr/local/lib/opentask-cli/index.js
RUN printf '#!/bin/sh\nexec node /usr/local/lib/opentask-cli/index.js "$@"\n' > /usr/local/bin/opentask \
  && chmod +x /usr/local/bin/opentask \
  && ln -s /usr/local/bin/opentask /usr/local/bin/ot \
  && ln -s /usr/local/bin/opentask /usr/local/bin/opendoist \
  && ln -s /usr/local/bin/opentask /usr/local/bin/od
ENV OPENTASK_URL=http://127.0.0.1:7968
ARG OPENTASK_VERSION=nightly
ENV NODE_ENV=production \
    OPENTASK_VERSION=${OPENTASK_VERSION} \
    OPENTASK_DATA_DIR=/data \
    OPENTASK_WEB_DIST=/app/web-dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 7968
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:7968/api/health || exit 1
WORKDIR /app/server
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
