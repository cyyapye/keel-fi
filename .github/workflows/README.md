# GitHub verification and deployment workflows

`ci.yml` runs before merge for pull requests and merge-queue candidates. Its
four jobs are intentionally independent so failures are targeted and the slow
browser path can run in parallel:

- `Quality`
- `D1 migration and synthetic seed`
- `Critical browser flows`
- `Secret scan`

Configure the `main` branch ruleset to require all four jobs and require the
branch to be up to date before merge.

`post-merge.yml` runs `make verify` plus a full-history secret scan on the exact
commit pushed to `main`. After both jobs pass, it automatically deploys that
same SHA to the protected Cloudflare preview. A manual dispatch deploys only
when it targets `main`.

The preview deployment is serialized and fail-closed. It exports, encrypts, and
round-trip verifies D1 before applying forward-only migrations, deploys the API
before the web Worker, runs protected Access/dashboard/D1/R2/Queue smokes, and
verifies both Worker version IDs and Git SHA. It never runs a remote seed
command. Encrypted backup artifacts are retained for 14 days; non-sensitive
release evidence is retained for 90 days.

Until the M9.2 canonical-only cutover is recorded, a manual dispatch exposes one
explicit `restore-pre-m9-canonical-cutover` action. It restores the synthetic
preview to the last verified Time Travel point before migration `0019`, and only
after the encrypted backup has uploaded. Ordinary pushes and the default
`migrate-forward` dispatch never restore D1. Remove this one-time action in the
M9.2 evidence change; it is forbidden once any environment retains real user
data.

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

Robinhood sync is optional. To enable it in preview, configure the complete
secret group `KEEL_PREVIEW_CONNECTOR_CREDENTIAL_KEY`,
`KEEL_PREVIEW_PLAID_CLIENT_ID`, `KEEL_PREVIEW_PLAID_ENVIRONMENT`,
`KEEL_PREVIEW_PLAID_REDIRECT_URI`, and `KEEL_PREVIEW_PLAID_SECRET`. The
deployment validation rejects a partial group. See
[the Robinhood sync runbook](../../docs/deployment/robinhood-holdings-sync.md).
The deployment derives a second custom domain by adding `-webhooks` to the first
label of `KEEL_PREVIEW_URL`. That hostname exposes only `POST /webhooks/plaid`;
preview smoke proves its root is `404` and an unsigned delivery fails closed
before the protected dashboard checks continue.

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
removed before artifact upload.

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
