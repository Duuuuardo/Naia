# Naia — marca guarda-chuva de comunicação

Turborepo da marca **Naia** (`naia.website`), com dois produtos independentes e a landing da marca:

```
naia/
├── apps/
│   └── landing/          # naia.website — landing da marca (apresenta os dois produtos)
├── packages/             # compartilhados de MARCA (nunca dados de produto)
│   ├── config/           # @naia/config — tsconfigs + tema Tailwind da marca
│   ├── ui/               # @naia/ui — logos e componentes de marca
│   └── vianova-auth/     # @naia/vianova-auth — validação de JWT do Vianova via JWKS
├── campaigns/            # PRODUTO: Naia Campaigns (campaigns.naia.website)
│   ├── apps/             #   api :4001 · web :3001 · worker (BullMQ)
│   └── packages/         #   client · db (pg :5435) · entitlements · queue · schemas
└── crm/                  # PRODUTO: Naia CRM (crm.naia.website) — scaffold, Milestone 3
    ├── apps/             #   api :4002 · web :3302
    └── packages/         #   client · db (pg :5436, schema vazio)
```

**Invariantes:** Campaigns e CRM não compartilham nenhum dado (contatos, conexões,
bancos, planos). O que é compartilhado aqui é só marca e infraestrutura de código
(`packages/`). Identidade/billing vivem no Vianova — nenhum produto tem login próprio.

## Comandos

```bash
bun install
docker compose up -d        # postgres naia :5435, postgres crm :5436, redis :6381
bun run dev                 # tudo via turbo
bun run dev:campaigns       # só o produto Campaigns
bun run dev:crm             # só o produto CRM
bun run dev:landing         # só a landing da marca
bun run typecheck
```

Regras de negócio e stack: ver `docs/` no repo NovaPlatform (skills `naia-rules`,
`naia-stack`, `crm-rules`, `crm-stack`).
