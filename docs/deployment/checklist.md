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
- [ ] Source allowlists, SSRF protection, redirect limits, timeouts, and byte
      limits are tested before any network connector is enabled.
- [ ] Upload types, sizes, quarantine, and malware scanning are enforced before
      uploads are enabled.
- [ ] Imported facts appear as proposals requiring explicit review.

## Release evidence

- [ ] Git commit, CI run, migration names, Worker versions, and reviewer are
      recorded privately.
- [ ] Post-deploy dashboard, evidence, D1, Access, R2, and Queue smokes pass.
- [ ] Runtime API/web Git SHA and Worker version IDs match deployment output.
- [ ] Rollback owner and last-known-good Worker version are identified.
