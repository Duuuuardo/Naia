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
RUN bun run --cwd ${APP} build

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ARG APP
ENV NODE_ENV=production
ENV APP=${APP}

# API apps output to dist/index.js, web/landing apps output to .output/server/index.mjs
COPY --from=base /app/${APP} ./app_src
RUN ([ -d ./app_src/dist ] && cp -r ./app_src/dist ./dist || true) && \
    ([ -d ./app_src/.output ] && cp -r ./app_src/.output ./.output || true) && \
    rm -rf ./app_src
COPY --from=base /app/node_modules ./node_modules

EXPOSE 3000
CMD ["sh", "-c", "if [ -f .output/server/index.mjs ]; then bun .output/server/index.mjs; else bun dist/index.js; fi"]
