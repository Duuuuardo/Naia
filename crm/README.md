# Naia CRM

CRM multicanal completo (`crm.naia.website`) — subprojeto do turborepo da marca Naia.

O produto cobre o ciclo completo de relacionamento com o cliente: **inbox de
atendimento** (WhatsApp + Telegram, com anexos), **filas de atendimento**,
**transferências** entre agentes/filas, **funis de vendas multi-pipeline** (deals em
kanban), **bot builder** visual com handoff para humanos, **chat interno**,
**respostas rápidas**, **biblioteca de arquivos** (MinIO próprio) e **relatórios**.

Dois contextos de acesso na mesma web app (detectados pelo `host` no SSR):

- **Apex** (`crm.naia.website`, login Vianova): gestão da conta — home, agentes,
  membros, assinatura e settings.
- **Subdomínio do workspace** (`[slug].crm.naia.website`, login de agente com
  email+senha): app do agente — inbox, funis, contatos, chat interno, bot,
  respostas rápidas, arquivos, relatórios e admin interna (exclusiva do role
  `superadmin`: conexões, filas, agentes, permissões).

## Apps

| App | Package | O que é | Porta dev |
|---|---|---|---|
| `apps/api` | `@crm/api` | API Elysia (Bun) — auth dual (Vianova OIDC no management, JWT próprio no agente), WebSocket do inbox, bridge Redis→WS | 4002 |
| `apps/web` | `@crm/web` | TanStack Start SSR — painel de gestão (apex) + app do agente (subdomínio) | 3002 |
| `apps/worker` | `@crm/worker` | Consumers BullMQ — pipeline de mensagens (inbound/outbound), status de entrega, engine do bot | — |
| `apps/session-host` | `@crm/session-host` | Sessões de canal — WhatsApp (Baileys, QR, auth state no Postgres) e Telegram (bot token via grammy). Único processo que fala com WhatsApp/Telegram; comandos por HTTP interno (`x-internal-secret`), eventos por Redis pub/sub | 4020 |

## Packages

| Package | O que é |
|---|---|
| `@crm/db` | Drizzle + Postgres (banco `crm`, pg :5436) — schema e migrações |
| `@crm/client` | Eden Treaty tipado a partir de `@crm/api` — o web nunca usa `fetch` manual |
| `@crm/entitlements` | Checks de limite/plano (funções puras, nunca inline em rota) |
| `@crm/events` | Contratos de evento exclusivos do CRM (`crm:session-events:v1`, `crm:inbox-events:v1`) |
| `@crm/queue` | BullMQ/Redis com prefixo `crm:bull` (`inbound-messages-v1`, `outbound-messages-v1`) |
| `@crm/schemas` | Tipos de domínio compartilhados (roles de agente, matrizes de permissão, MediaRef) |
| `@crm/storage` | MinIO via `Bun.S3Client` (bucket `naia-crm`) — presign → PUT direto → confirm; anexos nunca em base64 no banco |

## Scripts

Todos os apps rodam com Bun a partir do `.env` da raiz do repo `naia/`:

```bash
bun run dev        # em cada app (bun --hot --env-file ../../../.env)
bun run build      # build para produção
bun run typecheck  # tsc --noEmit
```

Banco (em `packages/db`):

```bash
bun run db:generate   # gera migração a partir do schema
bun run db:migrate    # aplica migrações
bun run db:studio     # Drizzle Studio
```

## Referências

- Regras de negócio: `docs/crm-business-rules.md` (skill `crm-rules`).
- Padrões de código e arquitetura: `docs/crm-stack.md` (skill `crm-stack`).
- Integração com o ecossistema (Vianova, portas, isolamento do Campaigns):
  `docs/architecture.md`.

Invariantes: banco/planos/entitlements totalmente separados do Campaigns (padrões
podem ser espelhados copiando, nunca importando); auth de managers só via Vianova
(OIDC); entitlements só via `POST /internal/entitlements` com service token do
Vianova; o session-host é o único processo que fala com os canais; anexos sempre
via `@crm/storage` (MinIO), nunca base64 no banco.
