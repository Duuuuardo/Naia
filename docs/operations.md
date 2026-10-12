# Operations

## Services and ports (dev defaults)

| Service | Port | Notes |
| --- | --- | --- |
| postgres | 5435 | `naia` database (+ `naia_test` for tests) |
| redis | 6381 | BullMQ queues, session data, send idempotency |
| minio | 9102 / 9103 | S3 API / console |
| session-host (base) | 4010 | WhatsApp base connections |
| session-host (scale) | 4011 | per-workspace scale connections |
| api | 4001 | |
| web | 3001 | |
| landing | 3301 | |

## Migrations

Schema lives in `campaigns/packages/db/src/schema/`; SQL migrations in
`campaigns/packages/db/drizzle/`.

```bash
cd campaigns/packages/db
bun run db:generate   # schema → new migration SQL (requires snapshot meta)
bun run db:migrate    # apply pending migrations (also runs at API boot)
```

Every migration needs a matching `drizzle/meta/NNNN_snapshot.json`; `generate`
diffs the latest snapshot against the schema. If snapshots ever go missing
again (they did once: migrations 0008–0015 had been hand-written), regenerate
a baseline with `drizzle-kit pull` against a migrated database and place it as
the latest snapshot, or `generate` will produce spurious diffs.

## Worker runtime

One process runs four logical loops:

- **Outbound workers**: consume `whatsapp-outbound-*` / `telegram-outbound-*`
  queues (base + per-workspace scale queues discovered from Redis metadata).
- **Pacer worker**: advances campaign runs (`campaign-pacer`), one step per
  burst with DB-token dedup.
- **Status-webhook worker**: applies provider delivery/read/failed events
  (concurrency 20).
- **Scheduler + recovery tick**: every 30s claims due campaigns/automations;
  every 60s reconciles counters, resets stale `sending`, resurrects lost
  pacers, closes orphan runs.

Restarting the worker is safe mid-campaign: all state is in Postgres, jobs are
retried by BullMQ, and recovery closes any gaps within ~10 minutes.

## Queues

- `whatsapp-outbound-base` / `whatsapp-outbound-<workspaceId>` (concurrency 1)
- `telegram-outbound-base` / `telegram-outbound-<workspaceId>` (concurrency 5)
- `campaign-pacer` (10), `status-webhook` (20)
- Job defaults: 3 attempts, exponential backoff from 2s; completed jobs
  retained ×1000, failed ×5000.

Queue discovery uses `SCAN` (never `KEYS`).

## Deployment

All five services build from the root `Dockerfile` with `--build-arg
APP=<path>` (see `docker-compose.prod.yml` for a self-hostable compose
topology). The API container entrypoint runs `migrate.js` before `index.js`,
so schema changes roll out with the deploy. Production env requires the
variables listed in `.env.example`. Rollback = redeploy the previous image
tag; for a schema-breaking migration, apply the reverse SQL manually.

Known gap: the `Dockerfile` has no `USER` directive, so containers currently
run as root. Adding a non-root user is a worthwhile hardening follow-up.
