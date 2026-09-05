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

## Automatic preview release backup

Before each preview migration, the post-merge workflow exports the remote D1
database to ephemeral runner storage and encrypts it with GPG AES-256 using the
GitHub `preview` environment passphrase. The workflow decrypts a verification
copy and byte-compares it with the export, records plaintext and encrypted
SHA-256 hashes, deletes both plaintext copies and the passphrase file, and
uploads only the encrypted export plus its non-sensitive manifest. Retention is
14 days.

The passphrase must be stored separately from downloaded artifacts, rotated
under the private recovery procedure, and available to the recovery owner. A
successful upload is a migration precondition. An encrypted artifact is not a
restore drill: periodically download one, verify both recorded hashes, decrypt
inside an approved restricted location, and restore into a new non-production D1
database.

Cloudflare D1 Time Travel and the backup captured by `d1 migrations apply` are
additional recovery layers, not substitutes for testing the encrypted export.
Production backup storage, retention, and approval remain separate from this
preview workflow.

## Private agreement recovery archive

The opt-in `Private document backup` workflow adds a daily PDF-and-metadata
recovery point; it does not replace the pre-migration D1 export above. Its
source is one canonical D1 export plus every referenced `application/pdf`
original. The current envelope is 4,096 PDFs, 1 GiB total PDF bytes, 20 MiB per
PDF, and 64 MiB of SQL. Exceeding a bound or missing/mismatched bytes fails the
entire job instead of silently publishing a partial recovery point. Quarantined
PDFs are included without parsing them. Non-PDF R2 objects are not backed up by
this archive.

`scripts/private-document-backup.ts` streams a versioned JSONL archive into GPG
AES-256. It then authenticates the complete ciphertext before interpreting any
recovered SQL, rebuilds an isolated in-memory SQLite database with extensions
disabled, runs foreign-key checks, and checks every recovered PDF's length and
SHA-256 against that metadata. It rejects duplicates, truncation, extra records,
and oversized/decompression output. No PDF is opened during restore checking.
Temporary plaintext/key files live only in an owner-only directory and are
removed on success or ordinary failure. A host crash or hard process kill still
requires the restricted runner's temporary-file cleanup procedure; do not claim
forensic erasure from `unlink`.

`scripts/private-document-backup-job.ts` uses separate credentials for D1 read,
original-PDF read, and encrypted-backup write. It uploads only after local
restore verification, to a unique conditional key under `daily/`, and reads back
the complete encrypted object to verify its hash and size. No documents, object
names, SQL, or keys are attached to GitHub artifacts or ordinary logs. A failed
or ambiguous PUT is not called a successful backup; a retry uses a new key and
does not overwrite an existing recovery point. One job runs at a time.

Activation requires owner approval and these operator steps:

1. Create a separate private R2 bucket. Disable its `r2.dev` URL and attach no
   public domain. Approve and configure a 14-day expiry for its `daily/` prefix
   only; never apply that policy to the source bucket or originals. R2 lifecycle
   expiry is not an exact-to-the-second deletion promise.
2. Create distinct bucket-scoped S3 credentials: Object Read for the original
   bucket and Object Read & Write for the backup bucket. The job cannot use its
   source credential to delete originals. Create a D1 read API token with the
   narrowest supported scope; it must not deploy Workers or administer R2.
3. Configure the protected GitHub `private-backup` environment's secrets listed
   by `.github/workflows/private-document-backup.yml`. Protect its main-branch
   access. Keep an offline recovery copy of its at-least-32-character random
   encryption passphrase separate from the storage account.
4. Set repository variable `KEEL_PRIVATE_DOCUMENT_BACKUPS_ENABLED=true` only
   after the approved bucket, lifecycle, credentials, MFA, and recovery owner
   are ready. Dispatch the workflow on main; inspect its terminal result and
   verify the encrypted object exists in the private bucket. No live backup
   coverage exists while the variable is unset.
5. Download that exact ciphertext using an authorized recovery credential and
   run the verification command below in private staging. Retain only the
   non-sensitive proof. Keep GitHub failure notifications enabled and inspect
   any missed daily run. The schedule is a daily target, not a zero-loss RPO.
6. Quarterly and before expansion, perform the full non-production recovery
   procedure below. An in-memory SQLite/PDF restore check does not prove a new
   D1 binding, Access policy, or recovered application deployment works.

```sh
KEEL_DOCUMENT_BACKUP_PATH=/restricted/recovery/documents.jsonl.gpg \
KEEL_DOCUMENT_BACKUP_PASSPHRASE_FILE=/restricted/recovery/key \
pnpm exec tsx scripts/private-document-backup.ts verify
```

Paths are illustrative, not a place to copy live material into a worktree. The
key file must be mode 0600. The scripts never restore over live D1/R2 bindings,
delete originals, or modify accepted history. Application-backed recovery and
deletion remain explicit operator actions. See the
[private-document baseline](../security/private-document-baseline.md).

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
