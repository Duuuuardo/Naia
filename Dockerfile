ARG APP=campaigns/apps/api

FROM oven/bun:1.3.14 AS base
WORKDIR /app
ARG APP
ENV NODE_ENV=production

COPY . .
RUN bun install --frozen-lockfile
ARG VITE_NAIA_API_URL=https://api.campaigns.naia.website
ARG VITE_NAIA_WEB_URL=https://campaigns.naia.website
ARG VITE_VIANOVA_API_URL=https://api.vianova.software
ARG VITE_VIANOVA_WEB_URL=https://app.vianova.software
ENV VITE_NAIA_API_URL=$VITE_NAIA_API_URL
ENV VITE_NAIA_WEB_URL=$VITE_NAIA_WEB_URL
ENV VITE_VIANOVA_API_URL=$VITE_VIANOVA_API_URL
ENV VITE_VIANOVA_WEB_URL=$VITE_VIANOVA_WEB_URL
RUN bun run --cwd ${APP} build
RUN if [ -f ${APP}/dist/server/server.js ]; then \
  cd ${APP} && \
  bun build dist/server/server.js --bundle --target bun --outfile /tmp/server.js && \
  mv /tmp/server.js dist/server/server.js; \
fi
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
COPY --from=base /app/campaigns/packages/db/drizzle ./drizzle
COPY docker-serve.mjs ./docker-serve.mjs

EXPOSE 3000
CMD ["sh", "-c", "if [ -f dist/server/server.js ]; then bun docker-serve.mjs; elif [ -f dist/migrate.js ]; then bun dist/migrate.js && bun dist/index.js; else bun dist/index.js; fi"]
