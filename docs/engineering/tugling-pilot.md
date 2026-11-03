# Isolated Tugling enforcement pilot

The native gate is the single CI execution owner for Keel's full verification
suite. The project-approved source is pinned in `.tugling/pilot.json`; the
accepted released adapter in `.tugling/project.json` remains separate. Both
adapters now accept Tugling `0.8.0` at
`01af7eda080d3ef49d9fabcb7dfdf40e949a693c`, the commit identified by the
annotated `v0.8.0` tag and `stable` branch when reviewed on 2026-10-20. The
[protected promotion and fresh-install canary](https://github.com/cyyapye/tugling/actions/runs/39139730998)
passed for that exact commit. The contract helper is unchanged from the prior
`0.7.0` pin; the existing required map, receipt checks and native assertions
remain authoritative.

Tugling 0.8 replaces its former skill names with the Pstack catalog. The
synthetic projection-read dogfood case now invokes `architect`, following the
upstream
[migration map](https://github.com/cyyapye/tugling/blob/01af7eda080d3ef49d9fabcb7dfdf40e949a693c/docs/lineage.md).
Its `legacy_skill` preserves `scale-cost-review` for comparisons against older
releases; its five decisions and readiness criteria are unchanged. Learning
stays local and is never a CI input or artifact.

## First setup and required execution

Keep the reviewed source checkout beside Keel, outside its discovery tree. Run
from Keel on the intended branch. A fresh checkout uses `make bootstrap` for
locked dependencies, synthetic D1 and Chromium. The existing PDF sandbox runbook
owns the provisioned rootless socket. The required gate explicitly runs
`make pdf-sandbox-build` as a dependency-tracked flow, including the daily
security refresh; focused local tests can reuse a prepared sandbox
configuration. No credentials, real records or environment files are needed.
Missing prerequisites fail closed.

```sh
export TUGLING_PILOT_SOURCE=/absolute/sibling/tugling-candidate
make pilot-validate
# Iterate with make test TEST_ARGS=..., make e2e E2E_ARGS=..., etc.
# Commit all intended source before required evidence.
mkdir -p .tugling/local
make pilot-verify > .tugling/local/pilot-required.json
receipt=$(python3 -I -c 'import json; print(json.load(open(".tugling/local/pilot-required.json"))["flow_verification"]["path"])')
python3 -I scripts/tugling-pilot.py evidence "$receipt"
```

The project-owned launcher validates the actual candidate Git root, raw pinned
revision, clean contents, index flags, regular helper path and exact Git blob
before executing Python with `-I`. Git routing, replacement objects and
fsmonitor cannot alter these checks. An ignored adjacent Python module cannot
shadow an import. The required entry point rejects runner selection, reporter,
Make and Node startup overrides. Supply the source path as an environment
variable, not a Make override. It serializes required runs within this checkout.

Execution goes one way: `make pilot-verify` → validated candidate
`--run-required` → independent native leaves. The map splits the existing
`make verify` work into its original checks and adds native case accounting,
Compose validation, local scenario verification and the existing Python
temporary-run tests. Each suite runs once. No required inventory refresh,
snapshot update, test filtering or model judging happens during execution.

Native unit and cost verification uses three workers and becomes ready after
integrity checks. Its owned PDF configuration is explicitly absent; separate
required flows prove real Chromium, reader and scanner behavior. Canonical
migrations prepare the sealed browser fixture. The provider-document boundary
completes before UI workers and remaining PDF isolation probes start. Workspace
builds can use any available native slot; source checks, migrations and all 11
flows remain independently required.

A ready-PDF-priority trial failed the complete 900-second budget despite passing
all unit and Python cases. The prior map order and source-before-PDF dependency
are restored. Complete browser accounting remains required.

The unit watchdog remains 25 minutes; the independent active-verification budget
is 15 minutes for the complete gate. Individual test deadlines, case accounting,
and resource and D1 cost assertions remain unchanged. The combined flow
watchdogs stay within the pinned harness's two-hour cap.

## Accepted rules and native proof

`.tugling/pilot-verification.json` maps the accepted rules to these checks:

| Accepted boundary                                              | Native assertion evidence                                                                                                                                                                                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic inputs, D1, integer money/ppm, append-only decisions | Public-data scan, domain/API/repository tests, migration and seed readbacks                                                                                                                                                         |
| Routine automatic updates and minimal review                   | Source-policy database tests and automatic investment, cash, baseline and investment-review browser flows; manual exceptions and missing values remain explicit                                                                     |
| Shared UI and responsive saved-state behavior                  | Existing shared-UI architecture assertions and the complete desktop/mobile functional and screenshot suite                                                                                                                          |
| Projection-only reads and collection growth                    | Real workerd query plans and D1 counters, positive/empty/unrelated-household history, 120-item workloads and documented maxima                                                                                                      |
| Aggregate recurring cost and security/latency                  | Existing virtual idle/outage/useful-work days, queue, authentication, client and browser timer tests with unchanged ceilings                                                                                                        |
| Resource and artifact capacity                                 | Real PDF reader/scanner isolation; 24-document/64-MiB capture limits; bounded input, output and time; backup inventory/byte and corruption tests; bounded GitHub bundles, repository capacity admission and outcome-based retention |
| Owned artifact lifecycle                                       | Exact-container cleanup on success/failure/timeouts, Linux temporary-run success/failure/SIGTERM cleanup and explicit debug ownership; 120-case CI packaging preserves sources, foreign files and profiles                          |
| Build and release boundary                                     | Existing initial-JavaScript budget, deployment workflow/configuration/evidence assertions, protected lane/order and exact version records                                                                                           |

Native cases are recorded individually in `.tugling/pilot-cases.json`, including
parameterized titles and both Playwright projects. The only existing exclusions
cover the Linux systemd parser and actual Linux worker shutdown on macOS, and
desktop-provider cases in the mobile project. Their identities and reasons are
explicit; their Linux desktop counterparts remain required. Every other missing,
additional, duplicate, skipped, failed, expected-failure or flaky case fails
accounting. A total count or a nonempty test file is insufficient. Native exit
codes and runner errors also must pass.

When adding or intentionally renaming native tests, review their assertions and
update the inventory in the same change. Use `vitest list --json=...` and
`playwright test --list --reporter=json` to propose identities in ignored local
files, then review the diff. Vitest's list omits platform-skipped cases:
preserve the explicitly listed Linux systemd case. Never regenerate the
inventory from a narrowed run or from a result containing an unexplained
exclusion. Python uses stable unittest module/class/method identities. The gate
cannot judge the quality of a deliberately weakened assertion; reviewers must
inspect those diffs.

## Evidence, retention and remaining boundaries

Required receipts bind all mapped requirements, commands and outcomes to the
clean committed project, map, adapter and helper. Inspect `REQUIRED_PASS` and
check it against that same clean commit. Receipts are editable local evidence,
not signed release attestations. Reports occupy one locked slot per native
runner under `.tugling/local/pilot`; browser output is replaced only by its next
owned native run. The helper automatically bounds its managed receipts to seven
days, 64 files and 16 MiB before and after required execution. Active writers
reserve capacity and hold locks; full active capacity rejects new work before
native execution. `make pilot-clean` explicitly applies the same retention
without running tests. Expiry is applied on invocation, not by an installed
background service. Legacy receipts outside `managed-v1`, the local-learning
ledger and foreign/active runtime state remain untouched. CI uploads only the
named synthetic reports/receipts, with seven-day retention.

For a bounded hosted rejection experiment, manually dispatch this workflow on
the reviewed pilot branch with `regression_probe=true`. The disposable runner
halves the real provider idle interval from 60 to 30 seconds, commits only that
mutation locally, and runs the same complete required entry point. It requires
`REQUIRED_FAIL` in `native-unit-and-cost` and the real idle-day assertion,
records the failed receipt, and restores the input revision. It does not push
the mutation. A successful probe means the expected regression was rejected; the
ordinary run supplies separate passing evidence for the unmodified PR head.

`native-verification.yml` runs the complete gate once per ordinary PR merge
candidate, merge-group candidate, or exact merged commit. All checkouts
explicitly select `github.sha`. The Quality, Migration and Browser PR jobs
validate the same complete receipt downloaded by its exact SHA/attempt artifact
name. They fail when the producer fails, is cancelled, or supplies missing,
expired, mismatched, or incomplete evidence. They do not rerun native suites.
The standalone `tugling-pilot.yml` is manual-only for isolated head experiments
and the regression rejection probe. No candidate workflow deploys or uses
protected credentials.

Receipts bind the project/map/helper, OS, architecture, Python version, declared
pinned toolchain, and GitHub repository/workflow/run/attempt/event SHA. Rerun
the whole workflow after a failed attempt; an earlier attempt's receipt is not
reusable. The active-verification budget is 900 seconds after the measured
scheduling and fixture optimizations; exceeding it fails required verification.
Every native flow duration and the slowest flows appear in Actions summaries.
Queue/setup time is excluded and must be assessed separately. See
[CI performance](ci-performance.md) for baseline and remaining capacity work.

Local proof does not establish remote availability of the candidate commit,
hosted required-check settings, remote CI, merged success, deployed usage,
scanner activation in provider services or a paid model certification. Those are
outside this pilot. The personal disk collector mentioned in the Linux runbook
is outside this repository; this gate proves its native ownership and retention
markers, not the external collector's seven-day scheduling. Human visual review
is still required for material UI changes; passing unchanged screenshots does
not replace it. Preserve the existing secret-scan and post-merge deployment
dependencies and production approval boundary.
