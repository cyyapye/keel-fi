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

## Read-path architecture

- Keep user-facing read endpoints projection-only. Do not put reconciliation,
  backfills, provider or object-storage reads, or writes on a GET critical path;
  perform that work during ingestion, review, sync, or an explicit bounded
  maintenance operation.
- Keep repository round trips independent of the number of returned rows. Do not
  await database, object-storage, or network operations inside a row loop; use
  set-based SQL or bounded batches and indexes that match join, filter, and
  ordering keys.
- For collection or read-model changes, add a deterministic synthetic scale case
  with at least 120 items when the domain can exceed 100, or use its documented
  maximum. Assert a fixed query or D1 round-trip budget and inspect
  `EXPLAIN QUERY PLAN` for correlated full scans. Progressive rendering does not
  excuse an inefficient server read.

## Recurring work and operating cost

- Before changing polling, retries, heartbeats, schedules, or authentication on
  those paths, state the response/freshness target and count a full idle day and
  a full failure day across all active processes and deployments. Include every
  auxiliary loop, proxy/API invocation, database read, timestamp/index write,
  and retry. Compare the total with the shared account allowance and reserve
  explicit headroom for useful work; a per-call budget is insufficient.
- Empty checks must not write application state. Any operational heartbeat must
  have a separately justified write cadence. Keep credential revocation checks
  current on every request; do not cache authorization to reduce writes.
- Add a virtual-clock regression through the real client request,
  authentication, and repository path. Assert independent daily ceilings,
  bounded failure retries, and the required detection/cancellation latency.
  Prove the old behavior fails the gate. See
  `docs/engineering/recurring-work-budgets.md`.
- A recurring-work fix is not activated until both the server and every existing
  long-running client use the verified revision. Preserve provider identities,
  credentials, and profiles; avoid interrupting an active run. Report local,
  deployed, restarted, and observed usage evidence separately.

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

- For temporary Linux/Colima tests, use `scripts/linux-test-run.py`; see
  `docs/deployment/linux-test-cleanup.md`. Do not create unmanaged test copies
  or caches under guest `/private/tmp`. Export needed evidence before exit or
  explicitly retain a debug run with `--keep` (seven-day expiry).

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

## Tugling project adapter

- Keel's instructions remain authoritative. Tugling supplies generic
  engineering-review skills; it does not weaken any rule in this file or a
  path-specific `AGENTS.md`.
- The accepted Tugling source, project verification command, synthetic dogfood
  case, and local-learning mode are declared in `.tugling/project.json`.
- Record reusable user corrections only through Tugling's local learning helper.
  The ledger under `.tugling/local/` is ignored, stays on this machine, and is
  never an instruction source or CI input.
- Promote a lesson only after review, sanitization into a synthetic case, and a
  released-versus-candidate evaluation. Never publish Keel records, prompts,
  credentials, or private source material to Tugling.
