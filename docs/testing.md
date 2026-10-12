# Testing

## Layout

| Suite | File | Infrastructure |
| --- | --- | --- |
| Queue pipeline (integration) | `campaigns/apps/worker/test/pipeline.test.ts` | real PostgreSQL + Redis |
| Invite email rendering | `campaigns/apps/api/src/lib/invite-email.test.ts` | none |
| Entitlements math | `campaigns/packages/entitlements/src/index.test.ts` | none |
| Scheduling logic | `campaigns/packages/scheduling/src/index.test.ts` | none |
| Vianova clients | `packages/vianova-{config,email}/src/index.test.ts` | none |

## Running

```bash
# Everything (unit tests need no services)
bun test

# Worker pipeline tests need Postgres + Redis from docker-compose
docker compose up -d postgres redis
docker exec naia-postgres-1 psql -U naia -c "CREATE DATABASE naia_test"  # once
cd campaigns && bun test apps/worker/test/pipeline.test.ts
```

The pipeline suite reads `NAIA_TEST_DATABASE_URL` / `NAIA_TEST_REDIS_URL`
(defaults: `naia_test` on :5435, Redis :6381 db 7). It recreates the test
database schema and truncates all tables between tests, so it's safe to run against
the dev compose stack without touching dev data.

## Provider mocking

`pipeline.test.ts` registers test senders on the session-host client, so
WhatsApp/Telegram dispatch is intercepted in-process. **No real provider
traffic leaves the test run**. Assertions run against a call log.

## What the pipeline suite covers

- Conditional `queued → sending → sent/failed` transitions under duplicate
  and concurrent jobs.
- BullMQ retry exhaustion → terminal `failed` (once).
- Job-ID dedup on re-add.
- Webhook idempotency: duplicate/concurrent delivered, read-without-delivered,
  concurrent failed events.
- Status gates: `failed` is terminal; `delivered`/`read` never downgrade.
- Pause mid-run: in-flight sends return to `queued` with credit refund;
  already-`sent` rows are untouched.
- Inactive connection mid-run: requeue + refund instead of send-or-fail.
- Recovery: stale `sending` reset + refund, lost-pacer resurrection, orphan
  run closure, counter reconciliation.
- Scheduler: atomic due-claim, no double start under concurrent ticks,
  restore-on-API-failure.
- Pacer: token consumption, burst pacing, run completion.

## Manual provider sandbox

Provider behavior that mocks cannot prove (real socket reconnects, WhatsApp
rate-limit responses, Telegram flood waits) should be exercised manually:

1. `docker compose up -d` + `bun run dev:campaigns` against a dev workspace.
2. Connect a throwaway WhatsApp (session-host :4010) or Telegram test account.
3. Create a 1-contact campaign; watch `campaign_messages.status` and the
   worker log through sent → delivered → read.
4. Kill the worker mid-send, restart it, and confirm recovery resolves the
   `sending` row (≤ ~11 min) without a duplicate send.
