# Naia — Instruções para o Agente

> Repo da marca Naia (comunicação). Contém a landing da marca e dois produtos independentes:
> **Campaigns** (`campaigns.naia.website`) e **CRM** (`crm.naia.website`).
> Leia `docs/naia-business-rules.md` / `docs/crm-business-rules.md`, `docs/naia-stack.md` / `docs/crm-stack.md`
> e `docs/design.md` antes de qualquer decisão de produto, código ou UI.

## Estrutura

- `apps/landing` — landing da marca `naia.website`.
- `packages/config` — tema Tailwind rosa (`brand-500 #DD5973`).
- `packages/ui` — logos/componentes compartilhados de marca.
- `packages/vianova-auth` — cliente OIDC + JWKS do Vianova.
- `packages/vianova-email` — client para enfileirar emails no Vianova.
- `packages/vianova-config` — client para o config server do Vianova.
- `campaigns/` — produto Naia Campaigns (`apps/{api,web,worker}` + `packages/{client,db,entitlements,queue,schemas}`).
- `crm/` — produto Naia CRM (`apps/{api,web}` + `packages/{client,db}`). **Só desenvolver com OK explícito do usuário (Milestone 3).**

## Regras de ouro

1. **Campaigns → invocar `naia-rules` e `naia-stack`. CRM → invocar `crm-rules` e `crm-stack`.**
2. **Antes de tocar em UI**: invocar `frontend-design` + ler `docs/design.md`.
3. **Toda entrega de UI**: passar por `emil-design-eng`.
4. **Nunca usar `fetch` manual no frontend** — sempre Eden Treaty.
5. **Nunca implementar cadastro/login/2FA/Stripe aqui** — tudo vive no Vianova.
6. **Campaigns e CRM não compartilham dados** (contatos, conexões, bancos, planos) — só marca e infra de código.
7. **Opt-in bloqueia disparo para WhatsApp** — não avisa, bloqueia.
8. **Disparo de campanha é sempre assíncrono** (BullMQ).
9. **Entitlements só são escritos via chamada service-to-service do Vianova** (`POST /internal/entitlements`).
10. **Landing/marketing nunca expõe implementação interna** (OIDC, JWT, stack, "inspirado em X").

## Docs relacionadas

- `../docs/architecture.md`
- `../docs/naia-business-rules.md`
- `../docs/crm-business-rules.md`
- `../docs/naia-stack.md`
- `../docs/crm-stack.md`
- `../docs/design.md`
- `../docs/decisions/001-monorepos-vs-microrepos.md`
- `../docs/decisions/002-centralized-email.md`
- `../docs/decisions/003-centralized-config-server.md`
- `../docs/decisions/004-design-systems-per-brand.md`
