# Linux test temporary storage

Use `scripts/linux-test-run.py` for temporary Linux test checkouts instead of
creating ad hoc `keel-*` directories in Colima. From macOS, invoke it through
the running default Colima VM (the checkout must be visible in the guest):

```sh
colima ssh -- python3 /absolute/keel/scripts/linux-test-run.py \
  --source /absolute/keel -- bash -lc \
  'pnpm install --frozen-lockfile --store-dir ../pnpm-store && pnpm exec playwright install chromium && pnpm test:e2e'
```

The guest needs Python 3.9+, Git, Node/pnpm matching `package.json`, and browser
system dependencies. The runner does not install system packages. It copies
current tracked files, including tracked edits, but omits `.env*`, untracked
files, and symlinks. Use synthetic inputs only. Each run has its own dependency
and browser caches; the example pins the pnpm store inside the run as well.

Success, failure, SIGINT, and SIGTERM remove the temporary checkout and stop its
process group. Copy any desired test evidence to an explicit host output path
before the command exits, or pass `--keep` before `--` to retain a debug run for
up to seven days. The printed directory is inside the guest. Snapshot changes
inside it are not automatically copied back to the source checkout.

Runs live under `/private/tmp/keel-test-runs/<uid>/run-*`. The versioned ownership
marker and `.lease` advisory lock are the contract with the personal
`cleanup-codex-disk-space` utility. Children inherit the lease. An interrupted
runner whose child survives remains protected; SIGKILL may leave an abandoned
directory for the collector. The utility's aggressive mode expires unlocked
ordinary runs after one day, retained debug runs after seven days, and trims
guest disks to return free blocks to macOS. Unmarked legacy paths are left
for manual review, not deleted by pattern.

Verification: `python3 scripts/test_linux_test_run.py`. This infrastructure-only
runner does not alter product runtime or migrations.
