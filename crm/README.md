# Naia CRM — scaffold (Milestone 3)

Subprojeto do produto **Naia CRM** (`crm.naia.website`) dentro do turborepo da marca Naia.

**Estado atual: apenas setup de estrutura.** Nenhuma feature de produto foi iniciada — o
desenvolvimento do CRM começa no Milestone 3, após OK explícito do usuário.

| Pacote | O que é | Porta dev |
|---|---|---|
| `@crm/api` | Elysia (Bun) — só `/health` por enquanto | 4002 |
| `@crm/web` | TanStack Start SSR — página placeholder | 3302 |
| `@crm/db` | Drizzle + Postgres (banco `crm`, schema vazio) | 5436 |
| `@crm/client` | Eden Treaty tipado a partir de `@crm/api` | — |

Regras de negócio: `docs/crm-business-rules.md` (skill `crm-rules`).
Padrões de código: `docs/crm-stack.md` (skill `crm-stack`).

Invariantes a lembrar quando o desenvolvimento começar: banco/planos/entitlements
totalmente separados do Campaigns; auth só via Vianova (OIDC); entitlements só via
`POST /internal/entitlements` com service token do Vianova.
