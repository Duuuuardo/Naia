# Naia — Instruções para o Agente

> Repo da marca Naia (comunicação). Contém a landing da marca e o produto
> **Campaigns** (`campaigns.naia.website`).
> Leia `docs/naia-business-rules.md`, `docs/naia-stack.md` e `docs/design.md`
> antes de qualquer decisão de produto, código ou UI.

## Estrutura

- `apps/landing` — landing da marca `naia.website`.
- `packages/config` — tema Tailwind rosa (`brand-500 #DD5973`).
- `packages/ui` — logos/componentes compartilhados de marca.
- `packages/vianova-auth` — cliente OIDC + JWKS do Vianova.
- `packages/vianova-email` — client para enfileirar emails no Vianova.
- `packages/vianova-config` — client para o config server do Vianova.
- `campaigns/` — produto Naia Campaigns (`apps/{api,web,worker,session-host}` + `packages/{client,db,entitlements,queue,schemas,scheduling,session-host-client,storage}`).

## Regras de ouro

1. **Campaigns → invocar `naia-rules` e `naia-stack`.**
2. **Antes de tocar em UI**: invocar `frontend-design` + ler `docs/design.md`.
3. **Toda entrega de UI**: passar por `emil-design-eng`.
4. **Nunca usar `fetch` manual no frontend** — sempre Eden Treaty.
5. **Nunca implementar cadastro/login/2FA/Stripe aqui** — tudo vive no Vianova.
6. **Opt-in bloqueia disparo para WhatsApp** — não avisa, bloqueia.
7. **Disparo de campanha é sempre assíncrono** (BullMQ).
8. **Entitlements só são escritos via chamada service-to-service do Vianova** (`POST /internal/entitlements`).
9. **Landing/marketing nunca expõe implementação interna** (OIDC, JWT, stack, "inspirado em X").

## Docs relacionadas

- `../docs/architecture.md`
- `../docs/naia-business-rules.md`
- `../docs/naia-stack.md`
- `../docs/design.md`
- `../docs/decisions/001-monorepos-vs-microrepos.md`
- `../docs/decisions/002-centralized-email.md`
- `../docs/decisions/003-centralized-config-server.md`
- `../docs/decisions/004-design-systems-per-brand.md`
