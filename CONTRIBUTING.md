# Contributing

## Branch flow

- Create `feature/<description>` or `fix/<description>` from `develop`.
- Open PRs against `develop`; use squash merge once CI passes.
- Promote `develop` to `main` via a non-squash PR. `main` represents production.
- Create `hotfix/<description>` from `main`. After shipping it on `main`,
  merge the same hotfix back into `develop`.
- Never force push to `main` or `develop`.

## Before opening a PR

Run `bun install --frozen-lockfile`, `bun run typecheck`, `bun test` and
`bun run build`. Document migrations, environment variables and rollback.
