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
deployment also waits: it requires a retained encrypted pre-migration backup,
which must not be skipped. The independent private-document backup workflow uses
its existing private object storage and is unaffected. No artifacts are deleted.

After GitHub confirms quota is available, delete the variable or set it to
`false`, then dispatch post-merge verification on current main. The existing
bounded retention policy resumes. Do not assume the first day of a month is the
account's reset date or that deletion immediately restores its accrued
allowance.

`ci.yml` runs before merge for pull requests and merge-queue candidates. Its
native verification runs once through `native-verification.yml` on the exact
event SHA after the secret scan succeeds. The named Quality, D1 migration and
synthetic seed, and Critical browser flows jobs validate its complete
same-attempt required receipt. Secret scan remains independent. All checks fail
closed, including if native execution is cancelled. The standalone Tugling
candidate workflow is manual-only, so ordinary PRs no longer run a second full
verification suite. See
[CI performance](../../docs/engineering/ci-performance.md).

All artifact uploads use the repository's bounded upload action. Successful
diagnostics expire after one day; failure/cancellation diagnostics are compacted
to at most 12 MiB and kept seven days. Backups keep their 14-day retention.
Payload limits, repository capacity admission, account billing boundaries and
native enforcement are defined in the
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

## Self-hosted runner lanes

The private repository uses two isolated Linux x64 runner services on the
existing OVH host:

- `keel-ci` runs PR and post-merge verification without repository secrets,
  cloud credentials, `sudo`, or a rootful Docker socket. It owns a separate
  rootless Docker daemon for the isolated, synthetic PDF-reader tests.
- `keel-deploy` runs only the protected `preview` environment deployment after
  verification and secret scan pass. It has a separate service user, home,
  runner root, and work directory, and it also has no Docker-socket access.

Both services are registered only to `cyyapye/keel-fi`. The host provides Docker
Compose and Playwright system libraries; workflows install the pinned Node,
pnpm, dependencies, and Chromium in the unprivileged job context. If a runner is
offline, its required job must queue and fail closed. Do not route public or
untrusted-fork pull requests to these persistent runners. Return PR jobs to
GitHub-hosted or ephemeral runners before changing repository visibility or
accepting untrusted contributors.

The CI account needs the rootless prerequisites and delegated cgroup-v2 CPU,
memory and process controllers described in the
[PDF sandbox runbook](../../docs/deployment/pdf-sandbox.md). The native gate
builds the sandbox images as a required flow alongside source checks. Image
consumers wait for that build, and real isolation probes remain required;
missing infrastructure fails the checks. Package installation happens inside the
sandbox image build, not with `sudo` in the runner job. The deployment lane does
not build or run PDFs.

`post-merge.yml` runs the complete native required gate, the exact pinned
Tugling project contract, and a full-history secret scan on the exact commit
pushed to `main`. The small secret-scan and Tugling contract jobs run before
native verification, so they cannot queue behind another long native run after
verification finishes. After all three jobs pass, it automatically deploys that
same SHA to the protected Cloudflare preview. A manual dispatch deploys only
when it targets `main`.

The preview deployment is serialized and fail-closed. It exports, encrypts, and
round-trip verifies D1 before applying forward-only migrations, deploys the API
before the web Worker, runs protected Access/dashboard/D1/R2/Queue smokes, and
verifies both Worker version IDs and Git SHA. It never runs a remote seed,
reset, import, or restore command. Encrypted backup artifacts are retained for
14 days; non-sensitive release evidence is retained for 90 days.

## GitHub `preview` environment

Create a repository environment named `preview`, restrict its deployment branch
to `main`, and configure the following environment value:

- Variable: `KEEL_PREVIEW_URL` — the HTTPS origin only, with no path.
- Secrets: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`,
  `KEEL_PREVIEW_API_WORKER`, `KEEL_PREVIEW_WEB_WORKER`, `KEEL_PREVIEW_D1_NAME`,
  `KEEL_PREVIEW_D1_ID`, `KEEL_PREVIEW_R2_BUCKET`, `KEEL_PREVIEW_QUEUE`,
  `KEEL_PREVIEW_QUEUE_DLQ`, `KEEL_PREVIEW_ACCESS_AUD`,
  `KEEL_PREVIEW_ACCESS_TEAM_DOMAIN`, `KEEL_PREVIEW_ACCESS_CLIENT_ID`,
  `KEEL_PREVIEW_ACCESS_CLIENT_SECRET`, `KEEL_PREVIEW_DEPLOYMENT_SMOKE_TOKEN`,
  and `KEEL_PREVIEW_BACKUP_PASSPHRASE`.

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
`-agents` custom domain. That hostname forwards only exact Mac-agent POST
routes; the API requires a target-scoped bearer token, and preview smoke proves
the root is `404` and an unauthenticated lease is rejected.

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
removed before artifact upload. The final always-run cleanup also removes the
encrypted backup copy, manifests, Wrangler output, release evidence, and
generated configuration from the persistent deployment runner after their
artifacts have uploaded.

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
