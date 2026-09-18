# Isolated Tugling enforcement pilot

This candidate pilot adds a complete native gate without accepting a new Tugling
release or changing Keel's product rules. `.tugling/project.json`, its 0.4.0
source pin, the synthetic dogfood case, `make verify`, focused developer
commands, and existing CI/deployment workflows remain authoritative and intact.
The candidate is 0.5.0 at `c5990a7f6827b3daa20e3d76a4d1fa017e41de3d`. Only
`.tugling/pilot.json` selects it. Learning stays local; the ignored ledger is
never read as instructions, used by CI, or uploaded.

## First setup and required execution

Keep the reviewed source checkout beside Keel, outside its discovery tree. Run
from Keel on the intended branch. A fresh checkout uses `make bootstrap` for
locked dependencies, synthetic D1 and Chromium. The existing PDF sandbox runbook
owns the provisioned rootless socket and image build. Reuse a prepared local
sandbox configuration; CI builds its own images with `make pdf-sandbox-build`.
No credentials, real records or environment files are needed. Missing
prerequisites fail closed.

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

## Accepted rules and native proof

`.tugling/pilot-verification.json` maps the accepted rules to these checks:

| Accepted boundary                                              | Native assertion evidence                                                                                                                                       |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic inputs, D1, integer money/ppm, append-only decisions | Public-data scan, domain/API/repository tests, migration and seed readbacks                                                                                     |
| Routine automatic updates and minimal review                   | Source-policy database tests and automatic investment, cash, baseline and investment-review browser flows; manual exceptions and missing values remain explicit |
| Shared UI and responsive saved-state behavior                  | Existing shared-UI architecture assertions and the complete desktop/mobile functional and screenshot suite                                                      |
| Projection-only reads and collection growth                    | Real workerd query plans and D1 counters, positive/empty/unrelated-household history, 120-item workloads and documented maxima                                  |
| Aggregate recurring cost and security/latency                  | Existing virtual idle/outage/useful-work days, queue, authentication, client and browser timer tests with unchanged ceilings                                    |
| Resource and artifact capacity                                 | Real PDF reader/scanner isolation; 24-document/64-MiB capture limits; bounded input, output and time; backup inventory/byte and corruption tests                |
| Owned artifact lifecycle                                       | Exact-container cleanup on success/failure/timeouts, Linux temporary-run success/failure/SIGTERM cleanup and explicit debug ownership                           |
| Build and release boundary                                     | Existing initial-JavaScript budget, deployment workflow/configuration/evidence assertions, protected lane/order and exact version records                       |

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

`tugling-pilot.yml` uses Keel's ordinary unprivileged `keel-ci` lane, read-only
permissions, sibling checkouts and repository-native bootstrap. It explicitly
selects and asserts the PR head; merge-group runs assert that event's candidate.
The original `ci.yml` default merge-commit checks remain separate evidence. No
candidate workflow deploys, promotes a pin or uses protected credentials.

Local proof does not establish remote availability of the candidate commit,
hosted required-check settings, remote CI, merged success, deployed usage,
scanner activation in provider services or a paid model certification. Those are
outside this pilot. The personal disk collector mentioned in the Linux runbook
is outside this repository; this gate proves its native ownership and retention
markers, not the external collector's seven-day scheduling. Human visual review
is still required for material UI changes; passing unchanged screenshots does
not replace it. Preserve the existing secret-scan and post-merge deployment
dependencies and production approval boundary.
