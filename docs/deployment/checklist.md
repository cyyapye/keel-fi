# Private-alpha deployment checklist

## Ownership and accounts

- [ ] Hardware-backed MFA or passkeys protect GitHub and Cloudflare.
- [ ] Recovery methods and break-glass ownership are documented privately.
- [ ] API tokens use the minimum account and resource scopes.
- [ ] Protected `main` requires reviewed, passing CI.

## Data

- [ ] Repository and Git history pass secret scan and synthetic-only review.
- [ ] D1, R2, Queue, account, database, and Access identifiers remain outside
      public Git.
- [ ] R2 public access and public development URL are disabled.
- [ ] Backup destination is encrypted and access-restricted.
- [ ] A restore drill has passed in a non-production environment.

## Application

- [ ] `pnpm check` passes on the release commit.
- [ ] D1 migration and seed pass locally.
- [ ] Preview migration and production build pass.
- [ ] Preview deployment contains no remote seed, reset, import, or restore
      command.
- [ ] Encrypted pre-migration preview backup uploads before migrations begin.
- [ ] Missing and invalid Access assertions return `401` in production mode.
- [ ] Household authorization tests pass.
- [ ] Secure headers and `no-store` financial responses are present.
- [ ] Logs contain no assertions, bodies, financial values, document text, or
      source object keys.

## Ingestion

- [ ] Connector secrets use isolated bindings.
- [ ] When Plaid is enabled, only `POST /webhooks/plaid` is exposed on its
      dedicated hostname; invalid signatures fail closed and replay creates no
      second job.
- [ ] Source allowlists, SSRF protection, redirect limits, timeouts, and byte
      limits are tested before any network connector is enabled.
- [ ] Upload types, sizes, quarantine, and malware scanning are enforced before
      uploads are enabled.
- [ ] Imported facts appear as proposals requiring explicit review.
- [ ] Before Transactions activation, the deployment records its Plaid monthly
      Item rate, expected sync/mutation volume, Workers/D1 allowances, retention
      owner, deletion test, and approved incremental monthly cost ceiling.
- [ ] Transaction pages are discarded after bounded validation; tests confirm
      zero raw transaction R2 writes and redacted logs/browser responses.
- [ ] A Sandbox disconnect removes the Plaid Item, encrypted credential,
      operational cursor, and normalized transaction revisions while preserving
      reviewed aggregate and plan history.

## Investment institutions

- [ ] Additional-investment authorization remains disabled until every prior M9
      slice and its exact-SHA evidence have shipped.
- [ ] The exact institution variant's Investments and account-type coverage,
      unsupported cases, Item/product price, reconnect charge, expected manual
      checks and webhook volume, and approved monthly ceiling are recorded
      privately.
- [ ] Expected connection, container, coverage, position, exposure-mapping,
      snapshot, D1, and encrypted-backup growth remain inside the approved
      retention and cost boundary.
- [ ] A private Sandbox or provider-approved acceptance run proves several
      accounts, stable reconnect, same-label Items, partial coverage, and scoped
      disconnect without putting identifiers, holdings, values, or screenshots
      in Git or CI.
- [ ] New authorization can be disabled without deleting or rewriting accepted
      positions, decisions, baselines, plans, goals, or forecasts.
- [ ] Investments Refresh, a polling schedule, external notifications, and new
      paid products remain disabled unless separately approved.

## Release evidence

- [ ] Git commit, CI run, migration names, Worker versions, and reviewer are
      recorded privately.
- [ ] Post-deploy dashboard, evidence, D1, Access, R2, and Queue smokes pass.
- [ ] Runtime API/web Git SHA and Worker version IDs match deployment output.
- [ ] Rollback owner and last-known-good Worker version are identified.
