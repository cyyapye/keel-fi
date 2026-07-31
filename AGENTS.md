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
- Run `pnpm check`, `pnpm db:migrate:local`, `pnpm db:seed:local`, and
  `pnpm db:check:local` before publishing a change that affects runtime code or
  migrations.
