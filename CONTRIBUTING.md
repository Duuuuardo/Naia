# Contribuindo

## Fluxo de branches

- Crie `feature/<descricao>` ou `fix/<descricao>` a partir de `develop`.
- Abra PR para `develop`; use squash merge depois que o CI passar.
- Promova `develop` para `main` por PR sem squash. `main` representa produção.
- Crie `hotfix/<descricao>` a partir de `main`. Depois de publicar em `main`,
  incorpore o mesmo hotfix em `develop`.
- Nunca faça force push em `main` ou `develop`.

## Antes do PR

Execute `bun install --frozen-lockfile`, `bun run typecheck`, `bun test` e
`bun run build`. Documente migrations, variáveis de ambiente e o rollback.
