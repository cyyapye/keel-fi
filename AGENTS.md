# Keel contributor instructions

- Keep the public repository synthetic-only. Never commit real holdings,
  balances, people, account identifiers, source documents, messages, tax data,
  credentials, or values copied from a real portfolio.
- Treat D1 as the canonical source of application state. UI fixtures may exist
  only in browser tests.
- Use integer minor currency units and integer probabilities in parts per
  million. Never use JavaScript floating-point arithmetic for money.
- External observations create evidence events and proposed changes. They must
  not directly mutate accepted financial records. Acceptance requires a recorded
  human or deterministic policy decision; review does not always mean a human
  approval.
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
- Count actual D1 `rows_read` and `rows_written`, including index maintenance,
  independently of returned rows, statement count, and round trips. Inspect
  referenced views and integrity triggers. An indexed lookup repeated over
  household history can still be quadratic. Include positive matches, empty
  results, historical growth and unrelated households in cost holdouts. Grow
  history per returned item, including repeated observation dates; cover the
  complete latest/prior ordering, not just its leading timestamp.
- For collection or read-model changes, add a deterministic synthetic scale case
  with at least 120 items when the domain can exceed 100, or use its documented
  maximum. Assert a fixed query or D1 round-trip budget and inspect
  `EXPLAIN QUERY PLAN` for correlated full scans. Progressive rendering does not
  excuse an inefficient server read.

## Task-specific guidance

Load the applicable guidance when the task crosses its boundary:

- For user-visible frontend work, including `packages/ui` and visual tests, use
  [$keel-ui-quality](.codex/skills/keel-ui-quality/SKILL.md). It routes minor
  edits, diagnosis, and material changes to the required product and visual
  checks.
- For ingestion, source acceptance, or planning refresh, follow
  [source-update-policy.md](docs/architecture/source-update-policy.md). Routine
  updates use recorded policies; identity, evidence, and planning exceptions
  retain their review boundaries and manual decisions.
- Before changing polling, retries, heartbeats, schedules, or authentication on
  those paths, satisfy the change requirements and affected workload budgets in
  [recurring-work-budgets.md](docs/engineering/recurring-work-budgets.md).
- When preparing a PR or release, follow the verification and exact-revision
  evidence requirements in
  [.github/workflows/README.md](.github/workflows/README.md).

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
  or `make e2e` while iterating; repeat or broaden them when changes, failures,
  or unresolved concerns justify it. Documentation-only work uses relevant
  format, link, and instruction checks; required CI checks still apply.
- Do not copy `.env` files, credentials, or private financial inputs into
  worktrees. Local development uses only the checked-in synthetic seed.
- Continue authorized local work through implementation, relevant verification,
  and fixes caused by the change. Reuse existing authorization for these steps.
  Ask when an unresolved decision materially changes the outcome or an action
  exceeds the authorized scope. Report any unverified boundary explicitly.

## Tugling project adapter

- Keel's instructions remain authoritative. Tugling supplies generic
  engineering-review skills; it does not weaken any rule in this file or a
  path-specific `AGENTS.md`.
- The accepted Tugling source, project verification command, synthetic dogfood
  case, and local-learning mode are declared in `.tugling/project.json`.
- The isolated, unreleased enforcement pilot uses `.tugling/pilot.json` and
  `.tugling/verification.json` through `make verify-required`. See
  [the pilot contract](docs/engineering/tugling-required-pilot.md) for native
  coverage, existing test exclusions, and evidence boundaries. This adapter does
  not replace the accepted release or deployment pin. Update the required map
  and native assertions together when an accepted rule changes.
- Record reusable user corrections only through Tugling's local learning helper.
  The ledger under `.tugling/local/` is ignored, stays on this machine, and is
  never an instruction source or CI input.
- Promote a lesson only after review, sanitization into a synthetic case, and a
  released-versus-candidate evaluation. Never publish Keel records, prompts,
  credentials, or private source material to Tugling.

- When intentionally changing required test cases, update
  `.tugling/required-cases.json` with `make refresh-required-cases` and review
  the inventory diff alongside the accepted rule and native assertions. Do not
  regenerate the inventory to conceal unexpected missing coverage.
