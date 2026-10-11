# Generic Dockerfile for any Naia app or package.
# Build with: docker build --build-arg APP=campaigns/apps/api -t naia-campaigns-api ./naia
ARG APP=campaigns/apps/api

FROM oven/bun:1.3.14 AS base
WORKDIR /app
ARG APP
ENV NODE_ENV=production

# Copy full source (workspace resolution needs real package dirs).
COPY . .
RUN bun install --frozen-lockfile
# VITE_ vars are baked into the client bundle at build time AND read at runtime
# by server-side TanStack Start code via process.env. Defaults are production
# URLs; override via --build-arg if needed.
ARG VITE_NAIA_API_URL=https://api.campaigns.naia.website
ARG VITE_NAIA_WEB_URL=https://campaigns.naia.website
ARG VITE_VIANOVA_API_URL=https://api.vianova.software
ARG VITE_VIANOVA_WEB_URL=https://app.vianova.software
ENV VITE_NAIA_API_URL=$VITE_NAIA_API_URL
ENV VITE_NAIA_WEB_URL=$VITE_NAIA_WEB_URL
ENV VITE_VIANOVA_API_URL=$VITE_VIANOVA_API_URL
ENV VITE_VIANOVA_WEB_URL=$VITE_VIANOVA_WEB_URL
RUN bun run --cwd ${APP} build
# Bundle web app server into a single self-contained file so the runtime stage
# needs no node_modules. API apps already produce a standalone dist/index.js.
RUN if [ -f ${APP}/dist/server/server.js ]; then \
  cd ${APP} && \
  bun build dist/server/server.js --bundle --target bun --outfile /tmp/server.js && \
  mv /tmp/server.js dist/server/server.js; \
fi
# For campaigns API: build migrate script runnable via docker exec.
RUN if [ "${APP}" = "campaigns/apps/api" ]; then \
  bun build campaigns/apps/api/src/migrate.ts --bundle --target bun --outfile campaigns/apps/api/dist/migrate.js; \
fi

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ARG APP
ARG VITE_NAIA_API_URL=https://api.campaigns.naia.website
ARG VITE_NAIA_WEB_URL=https://campaigns.naia.website
ARG VITE_VIANOVA_API_URL=https://api.vianova.software
ARG VITE_VIANOVA_WEB_URL=https://app.vianova.software
ENV NODE_ENV=production
ENV APP=${APP}
ENV VITE_NAIA_API_URL=$VITE_NAIA_API_URL
ENV VITE_NAIA_WEB_URL=$VITE_NAIA_WEB_URL
ENV VITE_VIANOVA_API_URL=$VITE_VIANOVA_API_URL
ENV VITE_VIANOVA_WEB_URL=$VITE_VIANOVA_WEB_URL

COPY --from=base /app/${APP}/dist ./dist
# Migration SQL files — needed at runtime by migrate.js.
COPY --from=base /app/campaigns/packages/db/drizzle ./drizzle
# docker-serve.mjs: static-file server + SSR fallback for web apps.
COPY docker-serve.mjs ./docker-serve.mjs

EXPOSE 3000
# API: aplica as migrations antes de subir — migration falhando impede o boot
# (deploy quebra na hora, não no primeiro request contra schema velho).
# Web (dist/server) e workers (sem migrate.js) sobem direto.
CMD ["sh", "-c", "if [ -f dist/server/server.js ]; then bun docker-serve.mjs; elif [ -f dist/migrate.js ]; then bun dist/migrate.js && bun dist/index.js; else bun dist/index.js; fi"]
