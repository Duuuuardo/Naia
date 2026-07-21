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
# Merge app-level node_modules into root so the runtime stage has all packages.
RUN [ -d ${APP}/node_modules ] && cp -r ${APP}/node_modules/. node_modules/ 2>/dev/null || true

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app
ARG APP
ENV NODE_ENV=production
ENV APP=${APP}

COPY --from=base /app/${APP}/dist ./dist
COPY --from=base /app/node_modules ./node_modules

# Web apps (TanStack Start) export {fetch} from dist/server/server.js — wrap with Bun.serve().
# API apps go straight to dist/index.js which starts its own server.
RUN if [ -f dist/server/server.js ]; then \
  printf 'const port=parseInt(process.env.PORT||"3000");\nconst {default:h}=await import("./dist/server/server.js");\nBun.serve({port,fetch:h.fetch});\nconsole.log("Listening on port "+port);\n' > bun-serve.mjs; \
fi

EXPOSE 3000
CMD ["sh", "-c", "if [ -f bun-serve.mjs ]; then bun bun-serve.mjs; else bun dist/index.js; fi"]
