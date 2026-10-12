# Naia - Agent Instructions

Naia brand repo (communication). Contains the brand landing page and the
**Campaigns** product (`campaigns.naia.website`).

## Structure

- `apps/landing`: brand landing page for `naia.website`.
- `packages/config`: pink Tailwind theme (`brand-500 #DD5973`).
- `packages/ui`: shared brand logos/components.
- `packages/vianova-auth`: Vianova OIDC + JWKS client.
- `packages/vianova-email`: client for queueing emails in Vianova.
- `packages/vianova-config`: client for the Vianova config server.
- `campaigns/`: Naia Campaigns product (`apps/{api,web,worker,session-host}` + `packages/{client,db,entitlements,queue,schemas,scheduling,session-host-client,storage}`).

## Golden rules

1. **Never use manual `fetch` in the frontend** - always Eden Treaty.
2. **Never implement signup/login/2FA/Stripe here** - all of that lives in Vianova.
3. **Opt-in blocks WhatsApp dispatch**. It doesn't warn, it blocks.
4. **Campaign dispatch is always asynchronous** (BullMQ).
5. **Entitlements are only written via Vianova service-to-service calls** (`POST /internal/entitlements`).
6. **Landing/marketing never exposes internal implementation** (OIDC, JWT, stack, "inspired by X").

## Docs

- `docs/architecture.md`
- `docs/message-processing.md`
- `docs/security.md`
- `docs/testing.md`
- `docs/operations.md`
