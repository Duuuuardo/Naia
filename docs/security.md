# Security

## Authentication and authorization

| Boundary | Mechanism |
| --- | --- |
| Browser → API | Vianova OIDC session/JWT; JWKS-verified (`@naia/vianova-auth`) |
| Vianova → API `/internal/*` | Service tokens with explicit scopes, JWKS-verified |
| worker/scheduler → API | `x-internal-secret`, `timingSafeEqual` comparison |
| worker → session-host | same `NAIA_INTERNAL_SECRET` |
| Provider → API webhook verify | `WHATSAPP_VERIFY_TOKEN` (timing-safe) |

- Login, registration, 2FA, password reset and billing are **out of scope** —
  they live in Vianova. This repo verifies identity, it never issues it.
- Production boot validates required env vars (internal secret, webhook verify
  token, database, Redis) and refuses to start without them.
- Swagger/docs endpoints are disabled in production.

## Multi-tenancy

- All business tables carry `workspace_id`; routes resolve membership via
  `workspace_members` before any read/write.
- Background jobs carry the workspace implicitly through the message/campaign
  row — handlers re-read the row instead of trusting job payload for state.
- Rate limiting keys on the proxy-appended client IP (last hop of
  `x-forwarded-for`), not on client-supplied headers.

## HTTP hardening

Security headers on API and session-host responses:
`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, plus CORS restricted to
`NAIA_ALLOWED_ORIGINS`. Request rate limiting is enabled by default
(`RATE_LIMIT_WINDOW_MS`/`RATE_LIMIT_MAX`).

## Data handling

- `failure_reason` shown to users goes through `sanitizeErrorMessage` —
  SQL/driver internals never reach the UI or logs.
- Worker and session-host logs avoid contact objects, phone numbers and
  provider payloads; aggregates (counts, IDs) only.
- Media is stored in S3/MinIO under workspace-scoped keys; the API verifies
  object existence and size against storage before serving, not just DB rows.

## Opt-in / consent

- WhatsApp opt-out **blocks** sends — the send-time check in the worker is the
  enforcement point, not the UI.
- Campaigns require an explicit consent attestation (`consentAt`) before
  dispatch.
- Contacts auto-created from group expansion are marked `origem:grupo` with
  `opt_in_at NULL` — group membership is not consent, and the provenance stays
  auditable.

## Secrets and history

- `.env*` files are gitignored (`.env.example` is the only tracked env file).
- A `.env.bak` file was committed early in history and has been removed from
  the index — **the Redis URL and internal secret values it contained remain
  in Git history and should be rotated before public release.** See the
  repository's release notes / issue tracker for remediation status.
- Never commit provider session data; session-host auth state lives under
  `NAIA_SESSIONS_DIR` (default `/tmp/naia-sessions`), outside the repo.
