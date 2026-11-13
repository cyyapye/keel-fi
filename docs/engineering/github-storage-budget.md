# GitHub storage budget

Keel must stay within the account's included storage. All GitHub artifact
uploads use `.github/actions/upload-bounded-artifact`; no workflow may upload a
directory or use `actions/upload-artifact` directly. The action checks actual
file bytes, validates and paginates GitHub's complete repository artifact
inventory, counts all nonexpired artifacts regardless of their name or workflow,
and stops before upload if the proposed total exceeds **300 MiB**. Unavailable,
malformed or incomplete inventory fails closed. It requires only `actions: read`
in addition to normal artifact-upload credentials. It never deletes remote
artifacts.

| Artifact                                            | Payload ceiling | Retention |
| --------------------------------------------------- | --------------- | --------- |
| Required same-attempt receipt                       | 256 KiB         | 7 days    |
| Successful native/manual-pilot diagnostics          | 1 MiB           | 1 day     |
| Failed or cancelled native/manual-pilot diagnostics | 12 MiB          | 7 days    |
| Encrypted pre-migration backup and manifest         | 16 MiB combined | 14 days   |
| Exact deployment receipt                            | 256 KiB         | 90 days   |

The admission check reserves another 64 KiB per upload for outer ZIP overhead.
The backup/release rows describe retained legacy GitHub artifacts. New preview
backups and release records use the separate private R2 budget below. Legacy
backups keep their original expiry and are never deleted to reclaim quota.
Secret scans keep their existing findings, job summaries and failure gates;
their implicit SARIF artifact uploads are disabled.

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
the shared free quota for unlimited run volume. Keep **account-wide Actions and
Packages hard budgets** enabled, with **Stop usage when budget limit is
reached** and included-usage alerts. These are the billing backstop, not a
promise that uploads will always remain available. Both
$0
budgets visibly showed “Usage blocked” when inspected on 2026-10-26; repository
checks cannot attest or change hosted account settings. For a new no-charge
configuration, use $0
hard budgets. An existing operator-approved hard stop can remain unchanged for a
bounded trial only when the complete run envelope fits within confirmed included
usage. Record that approval and the live allowance privately. Do not raise a
budget or spend beyond included usage to enable a run. Recheck them after
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

During an account quota block, the temporary
[artifact-upload pause](../../.github/workflows/README.md#temporary-artifact-storage-pause)
keeps native verification running and transports its complete receipt through
bounded job outputs. Diagnostic downloads wait for GitHub storage to resume.
Preview uses private R2 backup and release storage, with verified database
backups still required before migrations.

## Run-volume envelope and enforcement

For a planning example, 10 successful native runs/day at the full 1 MiB cap and
one failed/cancelled run/day at 12 MiB retain about **120 MiB**, including seven
days of 256 KiB receipts and ZIP reserves. Legacy backup/release artifacts still
count until their normal expiry. Every GitHub upload records observed retained
and proposed bytes. The 300 MiB guard stops increased volume rather than
silently expanding storage. A sustained failure day of 10 failed runs/day would
retain 840 MiB of diagnostics alone over seven days and is unsupported.
Additional workflows, caches or run rates require a reviewed aggregate budget.

## Preview backup storage outside GitHub

Preview deployment uses a separate private R2 bucket with a **300 MiB** retained
object admission budget, including all names and objects awaiting lifecycle
expiry. Its whole backup/manifest ceiling remains 16 MiB with 14-day retention;
release records remain capped at 256 KiB with 90-day retention. Matching bucket
locks protect the retention window. The script refuses missing privacy or
retention configuration and never truncates or deletes backups for admission.
See [backup and recovery](../deployment/backup-and-recovery.md).

A planning envelope of two deployments/day, each with a 5 MiB backup and a 20
KiB release record, retains about 144 MiB, leaving more than 150 MiB within the
destination budget for manifests, lifecycle lag and retries. The maximum payload
on every attempt can exceed that envelope; admission then fails closed. This is
a destination budget, not an account-wide storage reservation. Preserve existing
account spending controls and include other R2 workloads before increasing the
cap or adding writers. GitHub quota and spending settings are unchanged.

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
