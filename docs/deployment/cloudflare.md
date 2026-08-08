# Cloudflare deployment runbook

This runbook is a template. The bootstrap task does not deploy resources or
request production secrets.

## Resources

Create in a private Cloudflare account:

- D1 database for canonical records;
- R2 bucket with public access disabled;
- Queue for ingestion proposals;
- private API Worker and static-assets Worker with a service binding; and
- Access application protecting the single public web origin.

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

## Production configuration

Configure these bindings outside Git:

- `ACCESS_AUD`: Access application audience;
- `ACCESS_TEAM_DOMAIN`: the exact team hostname used as JWT issuer;
- any future connector token as an isolated secret, not a general environment
  variable;
- `R2_SIGNING_KEY` only if the selected signed-URL mechanism requires one.

Production `ENVIRONMENT` remains `production`. Do not set it to `local` or add a
fallback. Keep the API Worker off `workers.dev` and preview URLs. Route `/api/*`
through the public web Worker to the API Worker with a service binding so the
Access assertion is preserved without creating a second public origin. Attach a
custom domain only after Access protects the route.

## Migration and release sequence

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

Run them only after replacing private deployment configuration and obtaining
explicit deployment approval.

The web Worker must keep `workers_dev` and preview URLs disabled in private
deployment configuration. Its only public route is the Access-protected custom
domain. The ingestion Queue consumer accepts only registry source IDs and loads
the approved host and URL policy from D1 before any fetch.

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
