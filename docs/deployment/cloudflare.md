# Cloudflare deployment runbook

This runbook covers the automatic private preview and the manually approved
production path. Repository bootstrap never deploys resources or requests
deployment secrets.

## Resources

Create in a private Cloudflare account:

- D1 database for canonical records;
- R2 bucket with public access disabled;
- Queue for ingestion proposals;
- private API Worker and static-assets Worker with a service binding; and
- Access application protecting the public app origin. When Robinhood is
  enabled, the same web Worker also owns a dedicated webhook custom domain that
  exposes only `POST /webhooks/plaid` and relies on Plaid signature validation
  instead of Access. Local portfolio agents use a separate custom domain that
  exposes only exact machine routes and requires a Keel device token.

Replace the D1 template ID in `apps/api/wrangler.jsonc` only in private
deployment configuration. Do not commit account IDs, database IDs, audiences,
team domains, or tokens.

## Local D1

```sh
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm db:seed:local
pnpm db:check:local
pnpm dev
```

Wrangler persists local D1 under the ignored `apps/api/.wrangler` directory.

## Automatic preview deployment

Every exact SHA pushed to `main` must first pass both post-merge verification
jobs. The same workflow then enters the GitHub `preview` environment and runs
one serialized deployment:

1. Validate every environment value and generate ignored private Wrangler
   configuration.
2. Export D1 to the isolated deployment runner, encrypt it with the independent
   preview backup passphrase, decrypt and byte-compare a verification copy,
   record both hashes, delete plaintext copies, and retain only the encrypted
   artifact for 14 days. The workflow removes the runner-local encrypted copy
   and evidence files after their artifacts upload.
3. Apply every pending D1 migration. Ordinary deployments never seed, reset,
   import, or restore the remote preview database.
4. Deploy the private API Worker with the merged SHA as its version tag, then
   build and deploy the web Worker with the same tag.
5. Use a dedicated Access service token to prove unauthenticated and invalid
   requests are denied, while an authenticated request reaches the protected
   health and dashboard surfaces. Separately prove the webhook hostname root is
   `404`, its unsigned Plaid endpoint fails closed, the agent hostname root is
   `404`, and an unauthenticated agent request is rejected.
6. Run the preview-only resource smoke. It performs `SELECT 1` through the D1
   binding, writes/reads/deletes a constant non-financial R2 canary, and
   publishes a typed Queue canary whose handler has an acknowledge-only path. It
   does not query a household, read a document, run a source scan, or mutate
   accepted records.
7. Compare the API and web runtime SHA/version metadata with Wrangler's
   deployment output, then retain a non-sensitive release-evidence artifact for
   90 days.

The job is fail-closed: no migration occurs unless the encrypted backup uploads
successfully, the web Worker cannot deploy until the API deploy succeeds, and a
smoke or exact-version mismatch fails the deployment. Cloudflare D1 also keeps
Time Travel history and captures a backup when migrations apply; the encrypted
export is the separate release artifact.

### Completed pre-live M9 cutover

The M9.2 canonical-only cutover completed against fully synthetic preview state
in
[run `31919271581`](https://github.com/cyyapye/keel-fi/actions/runs/31919271581).
The run retained an encrypted backup, rebuilt D1 through migration `0019`,
proved the removed transition objects and contract value were absent, deployed
the exact merge SHA, and passed the protected smokes. The temporary reset action
was then removed. Current preview workflows only apply forward migrations and
never seed, reset, import, or restore remote D1.

Configure the GitHub environment and Access service policy as documented in
[the workflow README](../../.github/workflows/README.md). Cloudflare account,
database, Worker, R2, Queue, Access, and token values remain outside Git.

## Production configuration

Configure these bindings outside Git:

- `ACCESS_AUD`: Access application audience;
- `ACCESS_TEAM_DOMAIN`: the exact team hostname used as JWT issuer;
- `MAC_AGENT_API_ORIGIN`: the dedicated HTTPS origin that accepts only scoped
  Mac agent requests;
- the complete shared Plaid connector secret group documented in
  [Robinhood holdings sync](robinhood-holdings-sync.md) and
  [cash accounts](cash-accounts.md), when either integration is enabled;
- any other future connector token as an isolated secret, not a general
  environment variable;
- `R2_SIGNING_KEY` only if the selected signed-URL mechanism requires one.

Production `ENVIRONMENT` remains `production`. Do not set it to `local` or add a
fallback. Keep the API Worker off `workers.dev` and preview URLs. Route `/api/*`
through the public web Worker to the API Worker with a service binding so the
Access assertion is preserved. If Robinhood is enabled, route only
`POST /webhooks/plaid` from a dedicated custom domain through the same service
binding, set its exact URL as `PLAID_WEBHOOK_URL`, and return `404` for every
other path on that hostname. Route only the documented Mac agent machine paths
from a separate custom domain, set its origin as `MAC_AGENT_API_ORIGIN`, and
return `404` for every other path on that hostname.

## Manually approved production sequence

1. Complete [the deployment checklist](checklist.md).
2. Export and verify the current D1 database.
3. Apply forward migrations to a preview database.
4. Run synthetic/preview smoke tests and Access negative tests.
5. Apply migrations to production.
6. Deploy the private API Worker, then the web Worker and static assets.
7. Verify missing, malformed, and valid Access assertions.
8. Verify the dashboard, evidence review, D1 writes, private R2 behavior, and
   Queue binding.
9. Record deployed Git commit, migration list, resource versions, and evidence.

Wrangler command shapes:

```sh
pnpm exec wrangler d1 migrations apply keel-production \
  --remote --config apps/api/wrangler.jsonc
pnpm --filter @keel/api exec wrangler deploy
pnpm --filter @keel/web build
pnpm --filter @keel/web exec wrangler deploy
```

Run production commands only after replacing private deployment configuration
and obtaining explicit deployment approval. Do not reuse the automatic preview
job or its credentials for production.

The web Worker must keep `workers_dev` and preview URLs disabled in private
deployment configuration. Public app routes remain Access-protected. The
optional Plaid hostname is webhook-only and signature-authenticated. Queue
consumers accept typed opaque internal IDs and resolve all provider or source
state from D1 before work begins. The agent hostname is machine-route-only and
each request is authenticated by a target-scoped token whose digest lives in D1.

## Access validation

The API independently verifies the `Cf-Access-Jwt-Assertion` signature against
the exact team issuer and application audience. A production request with a
missing assertion must return `401`; an invalid assertion must also return
`401`. These checks are release blockers.

## R2

Keep public development URLs and custom public domains disabled. Object keys
must be opaque and absent from ordinary API output and logs. Document reads must
be authorized by household and expire within five minutes.

## Rollback

Worker code can roll back to a previously verified version. D1 migrations are
forward-only: do not edit or reverse a deployed migration casually. If a schema
change breaks the release, roll back compatible Worker code or restore into a
new D1 database following [backup and recovery](backup-and-recovery.md).
