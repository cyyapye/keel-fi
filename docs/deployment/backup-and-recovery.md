# Backup, export, and recovery

D1 exports and R2 source documents contain Restricted data. Never commit, attach
to ordinary issues, or store them unencrypted.

## Strategy

- Schedule encrypted D1 exports with a documented retention window.
- Maintain an inventory of R2 objects and version/retention policy appropriate
  to the deployment.
- Store backups in a separate restricted account or boundary where practical.
- Protect backup credentials separately from Worker deployment credentials.
- Record migration versions, export timestamps, hashes, encryption method, and
  recovery owner without recording secret material.
- Perform quarterly restore drills for an active private alpha.

Command shape for an authorized export:

```sh
pnpm exec wrangler d1 export keel-production \
  --remote --output /restricted/encrypted-staging/keel.sql \
  --config apps/api/wrangler.jsonc
```

The example path is illustrative. Choose a restricted, encrypted location and
remove plaintext staging files after verifying the encrypted backup.

## Recovery procedure

1. Contain the incident or failure and prevent writes.
2. Select a verified export from before the corrupting event.
3. Create a new D1 recovery database; do not overwrite the only production copy.
4. Apply repository migrations through the export's recorded version.
5. Import the export with an authorized, audited Wrangler session.
6. Apply later compatible migrations.
7. Reconcile table counts, forecast input hashes, review decisions, actual
   distributions, and R2 object inventory.
8. Attach a preview Worker and run Access negative/positive tests plus critical
   browser tests.
9. Switch bindings only after an explicit go/no-go review.
10. Retain the previous database read-only for the approved recovery window,
    then dispose of it according to policy.

Recovery is complete only when canonical records, immutable history, Access,
document reads, and a new backup all verify.
