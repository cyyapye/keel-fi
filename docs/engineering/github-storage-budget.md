# GitHub storage budget

Keel must stay within the account's included storage. All repository uploads use
`.github/actions/upload-bounded-artifact`; no workflow may upload a directory or
use `actions/upload-artifact` directly. The action checks actual file bytes,
validates and paginates GitHub's complete repository artifact inventory, counts
all nonexpired artifacts regardless of their name or workflow, and stops before
upload if the proposed total exceeds **300 MiB**. Unavailable, malformed or
incomplete inventory fails closed. It requires only `actions: read` in addition
to normal artifact-upload credentials. It never deletes remote artifacts.

| Artifact                                            | Payload ceiling | Retention |
| --------------------------------------------------- | --------------- | --------- |
| Required same-attempt receipt                       | 256 KiB         | 7 days    |
| Successful native/manual-pilot diagnostics          | 1 MiB           | 1 day     |
| Failed or cancelled native/manual-pilot diagnostics | 12 MiB          | 7 days    |
| Encrypted pre-migration backup and manifest         | 16 MiB combined | 14 days   |
| Exact deployment receipt                            | 256 KiB         | 90 days   |

The admission check reserves another 64 KiB per upload for outer ZIP overhead.
Backups must fit whole; they are never truncated. A refused backup upload stops
deployment before migrations. Existing backup, checksum and deployment ordering
remain required. Secret scans keep their existing findings, job summaries and
failure gates; their implicit SARIF artifact uploads are disabled.

## Diagnostic contents

`scripts/ci-diagnostics.py` creates one ZIP in the owned
`.tugling/local/ci-upload/diagnostics.zip` location. Exact native reports,
resource samples and verification JSON take priority. Success bundles omit
browser output. Failure and cancellation bundles then admit error contexts, PNGs
and traces from exactly `browser-results/<lane>/<test>/<file>`, in that order,
until the compressed-byte budget is full. Nested Chromium profiles, caches,
downloaded sources, runtime databases and the local corrections ledger are
excluded. Source evidence is never modified or removed.

The bundle's `manifest.json` lists included files, omission counts and a bounded
sample of omitted paths/reasons. A single input over 8 MiB is recorded as
omitted; discovery above 5,000 candidate files fails closed. A cancellation
before reports exist still produces a manifest. Widespread failures can exceed
the evidence budget: review the full JSON failure list, omission manifest and
job logs, then reproduce affected cases locally. Do not increase the cap or
weaken test assertions to hide the failure. The original native test reporters,
screenshots, traces, assertions and required receipt validation remain
unchanged.

## Shared allowance and hard stop

GitHub's smallest published included artifact/Packages storage pool is 500 MB.
Use that conservative baseline even if the account has a larger plan. The 300
MiB Keel threshold leaves roughly 185 MB for other repositories, Packages,
archive overhead, billing lag and concurrent uploads. GitHub separately includes
10 GB of cache per repository. Keep the default cache ceiling; do not opt into
paid capacity. Current `setup-node` dependency caches need no additional copies.
See
[GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

This repository inventory check is an admission signal, not an atomic account
reservation. Other repositories, Packages and concurrent uploads can consume
headroom after it runs. Retention and per-upload limits alone cannot guarantee
the shared free quota for unlimited run volume. Keep **account-wide
$0 Actions
and Packages hard budgets** enabled, with **Stop usage when budget limit is
reached** and included-usage alerts. These are the billing backstop, not a promise
that uploads will always remain available. Both $0
budgets visibly showed “Usage blocked” when inspected on 2026-10-26; repository
checks cannot attest or change hosted account settings. Recheck them after
billing or plan changes in
[Budgets and alerts](https://github.com/settings/billing/budgets), following
[GitHub's budget guidance](https://docs.github.com/en/billing/how-tos/set-up-budgets).

Storage accrues over time in GB-hours; deleting a file does not undo the month's
accrued usage, and reporting can lag by 6–12 hours. Keep failure evidence and
backups until their normal expiry. If the guard refuses admission, wait for
expiry or inspect the account's full usage before choosing a reviewed change. Do
not auto-delete backup, active, foreign or failure artifacts to make a run
green. Workflow logs, Packages, billing settings and other repositories are
outside the repository artifact inventory.

## Run-volume envelope and enforcement

For a planning example, 10 successful native runs/day at the full 1 MiB cap, one
failed/cancelled run/day at 12 MiB, one 5 MiB backup/day and a daily 20 KiB
release receipt retain about **200 MiB**, including seven days of 256 KiB native
receipts and ZIP reserves. Real backup sizes and failure frequency vary; every
upload records the observed retained/proposed bytes and chosen retention in its
job summary. The 300 MiB guard stops increased volume rather than silently
expanding storage. A sustained failure day of 10 failed runs/day would retain
840 MiB of diagnostics alone over seven days and is deliberately unsupported.
Additional workflows, caches, backup growth or higher run rates require a new
aggregate budget with explicit headroom.

`make ci-storage-test` exercises the real packager on success, failure,
cancellation, partial output, repeat packaging, foreign files, links and 120
synthetic failing browser cases. The normal Vitest suite checks API pagination
across 120 artifacts, empty/expired/foreign results, malformed/inaccessible
inventory, payload limits, aggregate admission, retention and workflow routing.
`make check`/`make verify` run these checks; the complete native CI gate
includes both suites in its reviewed case inventory and required resource rule.

Tugling's available scale/cost and enforcement guidance already requires
recurring retention/cost estimates and owned artifact capacity tests. The
missing control here was Keel's upload policy and executable gates. This change
adds those controls locally; it does not require another generic skill or alter
the accepted Tugling release.
