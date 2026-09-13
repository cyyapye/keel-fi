# Required native verification pilot

This isolated Keel pilot exercises unreleased Tugling 0.5.0 at
`24aa7ec64524b5816858b09037e504c92af5251e`, available on upstream branch
`codex/keel-required-enforcement-pilot`. It does not accept that candidate as a
release. `.tugling/project.json`, `tugling.yml` and the post-merge deployment
contract retain released 0.4.0 at `e709bd77128e3d14ebc8ded37ccc2afe8f4b6eba`.

The separate `.tugling/pilot.json` uses the helper's pinned identity mode to
require that exact candidate commit. `scripts/verify-required.py` refuses a
different or dirty source before executing its code. Do not install a global
plugin, edit the upstream checkout, or advance the accepted adapter for this
pilot. The existing synthetic dogfood case and local learning mode are reused;
neither a model nor external learning service runs in verification.

## Execution

From a clean committed Keel checkout with its normal synthetic bootstrap and
rootless PDF infrastructure ready:

```sh
make verify-required TUGLING_SOURCE=/absolute/path/to/reviewed/tugling
```

There is one direction: the required helper runs native leaf commands, including
the self-contained `make verify`. The map never calls `make verify-required`.
Each mapped command runs once in order: Linux temporary-runner regressions,
default synthetic D1 migration/seed verification, then `make verify`. The
canonical gate still runs the real PDF isolation probes before source checks,
unit/API tests, builds and desktop/mobile browsers. No PDF failure is skipped or
replaced. Native focused commands remain available during editing; they do not
produce complete required evidence.

`tugling-pilot.yml` runs this same required command in the ordinary unprivileged
`keel-ci` lane on PRs and merge-queue candidates, without path filters or
optional failure. Its source checkout is explicitly ignored. It executes new
checks in every job and never consumes a prior receipt. This temporary pilot
workflow intentionally coexists with the unchanged accepted CI and release
workflows so it can be reviewed without changing their source or deployment
contract. It has no deployment job or production credentials. Publication,
hosted branch rules and independent review belong to the coordinator; local or
workflow-file evidence does not establish that merging is blocked.

## Required coverage and exclusions

`.tugling/verification.json` maps the accepted rules to the existing native
assertions and their policy sources. The canonical flow names actual tests,
runtime owners and all browser suites. It covers integer finance, D1 and
append-only history, recorded source decisions and exceptions, authentication,
projection-only reads, scale/query-plan and D1 billing holdouts, recurring-work
budgets, shared UI, real PDF isolation, document recovery, entry bundle size and
release safeguards. The separate migration and temporary-runner flows cover
their own native lifecycle checks. Existing ceilings and snapshots are
unchanged.

During `make verify`, native Vitest and Playwright reporters compare executed
test files with Git's inventory, independently of runner filters. Empty,
omitted, pending, unexpectedly skipped or non-passing required cases fail.
Focused-only tests are forbidden. Required Playwright execution includes both
`chromium` and `mobile-chromium`; the existing retry policy remains unchanged.
The native Python temporary-runner entry point also requires both existing
regressions to execute without skips.

Two existing platform exclusions are retained explicitly:

- The named systemd parser test is skipped outside Linux. Linux CI must run it.
- The 30 pre-existing mobile provider-capture/session exclusions are listed by
  exact file, title and reason in `.tugling/browser-exclusions.json`. Each is
  allowed only when the matching desktop case actually passes. The remaining
  provider UI cases and every other desktop/mobile suite stay required.

These are native assertions, not a model judge. They cannot prove that every
financial value is synthetic, judge visual clarity, detect a removed assertion
inside an otherwise passing test, or establish live provider, billing, backup,
release or hosted branch-protection behavior. Full-history secret scan and
release/deployment smokes remain in the accepted CI workflows. The temporary
runner tests exercise success/failure, signal cleanup, environment exclusion and
retained ownership; external disk-collector expiry and foreign/active artifact
handling still require their owning tool's proof. Review those boundaries under
the existing Keel contracts, not by increasing budgets or loosening the required
map.

## Evidence

The helper binds each receipt to the clean project commit, candidate identity,
config/map/helper digests, ordered commands, exit results and process cleanup.
Only `REQUIRED_PASS` plus a current `--check-required-evidence` check proves the
complete declared run. A selected `FLOWS_PASS`, contract validation or a passing
focused suite is narrower evidence. A pre-existing PDF infrastructure failure
still yields `REQUIRED_FAIL`; downstream checks remain unverified.

Receipts stay in ignored `.tugling/local/verification/`, independent of local
learning. Task logs and synthetic probe evidence stay in ignored
`.tugling/local/required-pilot/`; retain only this pilot's needed evidence and
remove it after coordinator handoff, no later than seven days. CI removes its
receipts on exit and retains native browser failure artifacts for seven days. No
ledger, environment file, provider data or private document is uploaded.

For failure probes, use disposable synthetic repositories inside the ignored
task directory. The native reporter regression tests run the real test CLIs
against passing, skipped and filtered fixtures and remove them in `finally`. The
coordinator's canonical run and independent known-defect probes remain separate
evidence; never report them as complete before their results exist.
