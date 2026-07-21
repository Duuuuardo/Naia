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
# Bundle web app server into a single self-contained file so the runtime stage
# needs no node_modules. API apps already produce a standalone dist/index.js.
RUN if [ -f ${APP}/dist/server/server.js ]; then \
  cd ${APP} && \
  bun build dist/server/server.js --bundle --target bun --outfile /tmp/server.js && \
  mv /tmp/server.js dist/server/server.js; \
fi

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ARG APP
ENV NODE_ENV=production
ENV APP=${APP}

COPY --from=base /app/${APP}/dist ./dist

# Web apps: wrap the {fetch} handler export with Bun.serve().
# API apps: dist/index.js is already a standalone server.
RUN if [ -f dist/server/server.js ]; then \
  printf 'const port=parseInt(process.env.PORT||"3000");\nconst {default:h}=await import("./dist/server/server.js");\nBun.serve({port,fetch:h.fetch});\nconsole.log("Listening on port "+port);\n' > bun-serve.mjs; \
fi

EXPOSE 3000
CMD ["sh", "-c", "if [ -f bun-serve.mjs ]; then bun bun-serve.mjs; else bun dist/index.js; fi"]
