# Keel contributor instructions

- Keep the public repository synthetic-only. Never commit real holdings,
  balances, people, account identifiers, source documents, messages, tax data,
  credentials, or values copied from a real portfolio.
- Treat D1 as the canonical source of application state. UI fixtures may exist
  only in browser tests.
- Use integer minor currency units and integer probabilities in parts per
  million. Never use JavaScript floating-point arithmetic for money.
- External observations create evidence events and proposed changes. They must
  not directly mutate accepted financial records.
- Forecast snapshots and accepted review decisions are append-only.
- Validate every external boundary with Zod and keep production authentication
  fail-closed.

## Codex and local workflow

- A fresh Codex worktree is prepared by `.codex/environments/environment.toml`.
  Run `make bootstrap` manually if setup needs to be repaired or repeated.
- Start the frontend and backend together with `make dev`. Use the URLs it
  prints because linked worktrees receive deterministic, isolated ports.
- Run `make verify` before publishing runtime or migration changes. Use focused
  targets such as `make lint`, `make typecheck`, `make test`, `make db-verify`,
  or `make e2e` while iterating.
- Do not copy `.env` files, credentials, or private financial inputs into
  worktrees. Local development uses only the checked-in synthetic seed.
