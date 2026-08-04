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

## Interface and copy

- Use the repo-local `$keel-ui-quality` skill for every task that creates,
  changes, reviews, diagnoses, or verifies user-visible frontend behavior.
- Treat `docs/product/ui-and-copy.md` as acceptance criteria for every material
  interface change.
- Compare a new or substantially changed screen with the closest existing Keel
  reference screens before implementing it. Holdings and Scenarios are the
  default references for information-dense and interactive work.
- Default to whitespace, spacing, and type hierarchy. Add a border, divider,
  badge, or container only when it communicates a real grouping, state, or
  interaction.
- UI copy must help the user act, decide, orient, or understand an essential
  trust boundary. Remove repeated explanations and internal implementation terms
  such as connector, append-only, immutable, retained, and private alpha unless
  the user needs that concept.
- Keep required synthetic-data and review-boundary disclosures concise and
  user-facing.
- For material screen changes, update and inspect the desktop and mobile
  Playwright screenshot baselines before handoff.

## Codex and local workflow

- A fresh Codex worktree is prepared by `.codex/environments/environment.toml`.
  Run `make bootstrap` manually if setup needs to be repaired or repeated.
- Start the frontend and backend together with `make dev`. Use the URLs it
  prints because linked worktrees receive deterministic, isolated ports.
- When the user says "clean up worktree" or makes a similar local-runtime
  cleanup request, run `make dev-clean` before handoff. It removes the Docker
  development containers, network, and synthetic database volume. Verify the
  stack is gone with `make dev-status`.
- Run `make verify` before publishing runtime or migration changes. Use focused
  targets such as `make lint`, `make typecheck`, `make test`, `make db-verify`,
  or `make e2e` while iterating.
- Do not copy `.env` files, credentials, or private financial inputs into
  worktrees. Local development uses only the checked-in synthetic seed.
