# GitHub verification and deployment workflows

## Temporary artifact storage pause

Set the repository variable `KEEL_PAUSE_ARTIFACT_UPLOADS=true` when GitHub
rejects uploads because the account storage allocation is exhausted. Native
checks, secret scanning, exact-revision checks and required receipt validation
still run. The complete receipt travels through bounded job outputs and is
validated again by each named PR check. Missing, truncated or invalid outputs
fail closed; no previous-run file or success flag substitutes for the receipt.

The pause skips receipt/diagnostic artifact uploads, so downloadable traces and
screenshots are unavailable; console logs and workflow summaries remain. Preview
deployment stores its encrypted D1 backup, manifest and release record in a
separate private R2 bucket and does not depend on GitHub artifacts. Upload and
complete read-back verification remain mandatory before migrations. The
independent private-document backup workflow is unchanged. No existing artifacts
are deleted.

After GitHub confirms quota is available, delete the variable or set it to
`false` to resume optional bounded diagnostic uploads. Preview deployment can
run while the pause stays enabled. Do not assume the first day of a month is the
account's reset date or that deletion immediately restores its accrued
allowance.

## Pull request checks

Every PR and merge group runs the secret scan. On the full path,
`native-verification.yml` runs once at the exact event SHA. Quality, D1
migration and synthetic seed, and Critical browser flows each validate the
complete receipt from that attempt. A failed or cancelled native run cannot
supply that receipt. The separate Tugling candidate workflow runs on manual
dispatch. See [CI performance](../../docs/engineering/ci-performance.md).

The complete required browser flow has a 300-second elapsed budget. Its launcher
times out and cleans up an overrun; receipt publication and validation also
reject a late success. Quality, D1, browser checks and preview cannot pass with
an over-budget browser receipt. The clock covers the browser command's profile
copies, server/browser startup, tests, reporting and teardown. The optional
isolated browser timing step has the same five-minute cap and rejects a late
successful completion.

Browser execution waits for source checks and unit/D1 verification to finish so
these heavy phases do not compete for the runner's memory and CPU. All remain
required within the complete gate's 900-second active budget.

Successful hosted setup also owns an exclusive compilation-cache root for the
job VM. Unit phases use separate directories and never upload this bytecode or
reuse it across phases or jobs. The VM disposes it after the job, including
cancellation. Local runs disable compilation caching. Aggregate storage
admission and the distinction from synthetic fixture teardown are documented in
[CI performance](../../docs/engineering/ci-performance.md).

For browser timing, dispatch the Tugling candidate workflow with
`isolated_browser` enabled. It prepares the same build and synthetic seed and
times the complete browser process on a fresh `ubuntu-24.04` VM. Compare its
elapsed time and case counts with a complete PR run on the same Git tree and
runner. The ordinary PR workflow supplies the required verification receipt.

For unit timeout diagnosis, dispatch the same manual workflow with
`isolated_unit` enabled. It runs the existing preflight and complementary main
unit flows under the pinned scheduler, with one 900-second active clock and
unchanged case deadlines. The complete unit inventory must still pass. This
partial diagnostic excludes competing source, build and PDF flows and emits no
required receipt. It cannot pass named PR checks or authorize deployment. The
three manual diagnostic modes are mutually exclusive. Confirm fresh included
compute headroom before dispatch; a push to a ready PR also starts full CI.

A same-repository draft targeting `main` can take a shorter path when its only
changes are edits to seven reviewed documents, four registered Vitest files,
three web stylesheets and their reviewed visual checks, or a combination of
those edits. The policy must already exist on the event base. Both the full PR
diff and the merge tree GitHub will test must qualify. Missing history, a policy
change or an unfamiliar path selects the full gate.

Selected documentation drafts run the public-data scan and formatting checks. A
test-file edit also runs repository-wide lint and type checks, then executes
every registered case in each edited test file with one worker. The job logs the
merge SHA and the selected cases.

Editing `apps/web/src/startup.css`, `apps/web/src/styles.css` or
`packages/ui/src/styles.css` selects the native graph on the same runner with
the same time budget. A stylesheet edit can include the Overview visual spec
and, when that spec changes, its existing desktop and mobile goal overview
references. Only the late embedded antivirus marker probe is omitted. Browser
coverage, the real 512-stream clean scan, raw antivirus detection, expanded-size
limit and sandbox isolation checks still run. The job reports a partial draft
result. Marking a PR ready, updating a ready PR, or entering a merge group runs
the full gate. Preview deployment requires its own full receipt for the merged
revision.

The
[hosted shadow trial](https://github.com/cyyapye/keel-fi/actions/runs/41874712167/job/126740723278)
replayed the original merge trees for two PRs on the verification runner. The
docs selection matched
[PR #184's full result](https://github.com/cyyapye/keel-fi/actions/runs/33334943281).
The SQLite selection passed all 28 registered cases. PR #334's first full
attempt timed out. The identical tree passed its
[first full post-merge attempt](https://github.com/cyyapye/keel-fi/actions/runs/41070788877).

All GitHub artifact uploads use the repository's bounded upload action.
Successful diagnostics expire after one day; failure/cancellation diagnostics
are compacted to at most 12 MiB and kept seven days. Backups keep their 14-day
retention. Payload limits, repository capacity admission, account billing
boundaries and native enforcement are defined in the
[GitHub storage budget](../../docs/engineering/github-storage-budget.md).

`tugling.yml` separately verifies the project adapter, synthetic dogfood case,
instruction routing, ignored local-learning ledger, and exact accepted Tugling
revision. It is deterministic and does not call a model. On repository plans
that cannot require checks for a private branch, this workflow provides
pre-merge feedback while `post-merge.yml` repeats the exact pinned contract as a
hard deployment dependency. A change can land on `main`, but it cannot reach
preview unless Tugling, native verification, and the secret scan all pass for
that exact commit.

Every Monday, and on manual dispatch, the workflow also checks Tugling's
`stable` branch. It passes while stable is the accepted version and fails closed
after stable advances, making the available update visible without changing
Keel's pin. Review the upstream release proof and run the synthetic Keel dogfood
case before accepting a new revision. Live model evaluation does not run on pull
requests.

## Functional tests and canonical visual comparisons

Local Playwright runs default to `KEEL_SCREENSHOT_MODE=functional`. They execute
behavior assertions without snapshot comparisons. The native CI job requires
`KEEL_SCREENSHOT_MODE=canonical` on its existing Linux x64 renderer. A
functional CI override, unknown mode, unsupported canonical renderer or
canonical `--ignore-snapshots` override fails closed. Baseline updates require
canonical mode. Do not interpret local functional success as a canonical visual
pass.

Playwright's `ignoreSnapshots` applies to image, text and accessibility snapshot
matchers. Keep the functional contract in direct role, value and state
assertions. Preserve exact-revision receipts, native coverage, retries, artifact
retention and spending stops. See the
[visual verification procedure](../../.codex/skills/keel-ui-quality/references/visual-verification.md).

## Disposable Linux workers

The complete native gate includes populated OLD-schema migration cost and
preservation evidence. Deployment and independent document backup retain their
existing execution paths. Shared quota admission and its activation requirements
remain in draft PR #340. See [D1 safety](../../docs/deployment/d1-safety.md) for
the proof scope and deferred runtime boundary.

Every concrete workflow job selects a fresh `ubuntu-24.04` GitHub-hosted VM.
Verification and protected deployment run in separate jobs and separate VMs.
Native verification receives no preview or private-backup secrets.

`scripts/ci-disposable-linux.py` prepares only the native verification and
manual pilot VMs. It rejects other runner environments, operating systems,
architectures, and root execution before provisioning. It installs Chromium
system dependencies, starts a user systemd session with delegated cgroup-v2
controllers, and prepares rootless Docker. It masks the preinstalled rootful
daemon and refuses a remaining rootful socket. Missing prerequisites fail the
job. The helper never changes a developer or provider runtime registry.

VM provisioning can use the hosted VM's `sudo`. PDF containers retain their
existing non-root, rootless, no-network boundary. The existing native flow owns
fresh image builds and real kernel isolation probes. Deployment and backup jobs
do not call the native setup helper or consume its Docker daemon. See the
[PDF sandbox runbook](../../docs/deployment/pdf-sandbox.md).

The native producer, manual pilot, and receipt consumers use a distinct
`keel-gh-ubuntu24-x64-node22.13.0-pnpm11.9.0-parallel-v8` environment identity.
The 900-second active native budget, 300-second complete browser budget,
registered cases, canonical screenshot baselines, and receipt checks remain
unchanged. A local workflow test does not establish hosted compatibility.

Changing YAML does not revoke a persistent runner registration. Before public
contributors can run workflows, remove both legacy repository registrations and
read back an empty runner inventory. Keep the repository private throughout
preparation. Follow the
[private CI migration procedure](../../docs/deployment/disposable-ci.md).

`post-merge.yml` runs the complete native required gate, the exact pinned
Tugling project contract, and a full-history secret scan on the exact commit
pushed to `main`. The small secret-scan and Tugling contract jobs run before
native verification, so they cannot queue behind another long native run after
verification finishes. After all three jobs pass, it automatically deploys that
same SHA to the protected Cloudflare preview. A manual dispatch deploys only
when it targets `main`.

The preview deployment is serialized and fail-closed. It exports, encrypts and
round-trip verifies D1, then stores the encrypted export and manifest privately
and verifies their complete read-back before applying forward-only migrations.
It deploys the API before the web Worker, runs protected Access/dashboard/D1/R2/
Queue smokes, and verifies both Worker version IDs and Git SHA. It never runs a
remote seed, reset, import or restore command. Private R2 retention locks and
lifecycle rules retain backups for 14 days and release records for 90 days.
Attempt-specific object keys and conditional PUTs refuse replacement. Bucket
privacy, retention and the 300 MiB retained-byte budget are checked before each
publication; missing or malformed storage evidence fails closed.

## GitHub `preview` environment

Create a repository environment named `preview`, restrict its deployment branch
to `main`, and configure the following environment value:

- Variables: `KEEL_PREVIEW_URL` — the HTTPS origin only, with no path;
  `KEEL_PREVIEW_BACKUP_BUCKET` — the separate private R2 backup bucket.
- Secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `KEEL_PREVIEW_API_WORKER`, `KEEL_PREVIEW_WEB_WORKER`, `KEEL_PREVIEW_D1_NAME`,
  `KEEL_PREVIEW_D1_ID`, `KEEL_PREVIEW_R2_BUCKET`, `KEEL_PREVIEW_QUEUE`,
  `KEEL_PREVIEW_QUEUE_DLQ`, `KEEL_PREVIEW_ACCESS_AUD`,
  `KEEL_PREVIEW_ACCESS_TEAM_DOMAIN`, `KEEL_PREVIEW_ACCESS_CLIENT_ID`,
  `KEEL_PREVIEW_ACCESS_CLIENT_SECRET`, `KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN`,
  and `KEEL_PREVIEW_BACKUP_PASSPHRASE`.

The existing Cloudflare API token must support R2 policy reads and temporary
credential issuance for the backup bucket. The job verifies its active parent
API token and derives 15-minute S3 credentials for only that attempt's exact
object keys. No permanent S3 key is added to GitHub, files, outputs or logs. The
encryption passphrase remains a separate protected environment secret. Follow
[backup and recovery](../../docs/deployment/backup-and-recovery.md) to provision
the private bucket and policy. Missing configuration stops the release before
migrations.

For a storage-only credential check, manually dispatch
`preview-backup-storage-check.yml` on `main`. It uses the same protected
environment and serialized deployment lane, writes/read-backs one small
synthetic canary, and never exports or mutates D1 or deploys Workers. Safe
phase/status/provider codes identify the failing storage boundary without
printing credentials or provider messages. See the
[preflight runbook](../../docs/deployment/backup-and-recovery.md#protected-storage-preflight).

Portfolio Watch website suggestions are optional. Set
`KEEL_PREVIEW_BRAVE_SEARCH_API_KEY` to enable the Find website action. Without
that secret, users can confirm a known official website directly in Coverage.
Search results require a recorded company-identity decision before monitoring.
Public-holding issuer recommendations use credential-free Wikidata entity lookup
when that optional secret is absent. The protected deployment smoke calls the
configured issuer provider with a synthetic query from the actual Worker and
records `issuer_lookup_provider` in the release receipt.

Robinhood sync is optional. To enable it in preview, configure the complete
secret group `KEEL_PREVIEW_CONNECTOR_CREDENTIAL_KEY`,
`KEEL_PREVIEW_PLAID_CLIENT_ID`, `KEEL_PREVIEW_PLAID_ENVIRONMENT`,
`KEEL_PREVIEW_PLAID_REDIRECT_URI`, and `KEEL_PREVIEW_PLAID_SECRET`. The
deployment validation rejects a partial group. See
[the Robinhood sync runbook](../../docs/deployment/robinhood-holdings-sync.md).
The deployment derives a second custom domain by adding `-webhooks` to the first
label of `KEEL_PREVIEW_URL`. That hostname exposes only `POST /webhooks/plaid`;
preview smoke proves its root is `404` and an unsigned delivery fails closed
before the protected dashboard checks continue. The deployment also derives a
`-agents` custom domain. It forwards exact Mac-agent POST routes with their
target-scoped credentials, plus the owner API, MCP, OAuth token/registration and
discovery paths used by [App access](../../docs/product/app-access.md). Browser
management stays behind Access on the browser origin. Preview smoke checks the
derived OAuth endpoints and absolute OpenAPI URL, a `404` root, and rejected
unauthenticated provider and owner requests. These public machine routes do not
grant access to household data without a scoped credential.

Use a custom Cloudflare API token scoped to the private preview account and only
the Worker, D1, Queue, and route/domain permissions required by these commands.
Do not use a global API key or a production token. The Access client values must
belong to a dedicated service token admitted by a Service Auth policy on the
preview Access application. The deployment smoke token and backup passphrase
must be independent random values of at least 32 characters.

GitHub does not expose environment secrets until the deployment job starts.
Within the job, each secret is passed only to the local step that needs it. The
generated Worker configuration is ignored by Git, the API secrets file exists
only for the API deploy command, and plaintext D1 export/passphrase files are
removed before private backup upload. The final always-run cleanup also removes
the encrypted backup copy, manifests, Wrangler output, release evidence, and
generated configuration from the persistent deployment runner after storage has
been verified. Cleanup never deletes remote recovery objects.

See
[GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments),
[Cloudflare Access service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
and the [Cloudflare deployment runbook](../../docs/deployment/cloudflare.md).

## Production

No workflow deploys production. Run the production sequence in the deployment
runbook only after explicit operator approval. If the repository plan supports
protected private environments, keep production credentials in a separate
environment with required reviewers as an additional gate. Preview credentials
must not be accepted by production resources or Access policies.
