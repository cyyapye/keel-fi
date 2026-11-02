# Backup, export, and recovery

Remote D1 backup work requires the shared maintenance admission in
[D1 safety](d1-safety.md). Missing or stale capacity/target evidence stops
before export. This does not authorize skipping integrity checks, expanding
source credentials or replaying an uncertain export. Shared-owner publication
and access must be verified separately before activation.

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

Before each preview migration, the post-merge workflow exports remote D1 to
owner-only ephemeral runner files and encrypts it with GPG AES-256 using the
GitHub `preview` environment passphrase. It decrypts a verification copy,
byte-compares the export, records both SHA-256 hashes in a versioned manifest,
and removes plaintext and passphrase files before uploading.

`scripts/preview-deployment-storage.ts` stores the complete ciphertext and
manifest in a separate private R2 bucket under
`backups/<git-sha>/<run-id>-<attempt>/`. Every PUT is conditional on the key
being absent. Each complete object is read back and checked for exact length and
SHA-256; only then is the local storage receipt written and migration allowed.
Failed or ambiguous writes never count as success, retry in place or delete a
recovery point. A new workflow attempt has new keys. Partial ciphertext uploads
remain protected until their normal expiry.

The workflow's existing Cloudflare API token authenticates policy reads and
creates 15-minute S3 credentials scoped to the exact files of that phase. The
parent token remains inside the protected deployment environment; derived keys
stay only in process memory and are never logged, written to disk or published.
Encryption uses a separate protected passphrase. No permanent S3 key or extra
Worker binding is required. A token without the required R2 permissions fails
before migrations; the workflow does not expand its own permissions. User-token
verification returning 401 or 403 selects the fixed account-token verification
endpoint once. Both token types must verify active; invalid tokens still fail
closed, while transport, rate-limit and server errors are not retried.

After exact Worker-version smokes pass, the release JSON binds the verified
backup receipt, ciphertext hash, migration names, Worker versions, Git SHA and
workflow attempt. It is stored and read-back verified under
`releases/<git-sha>/<run-id>-<attempt>/release.json`. A release-record storage
failure fails the deployment job even when Workers have already changed; inspect
the recorded versions before retrying. GitHub artifact availability is not a
deployment dependency. Existing GitHub backup artifacts retain their original
expiry and are not deleted.

Provision the destination in the same approved Cloudflare account:

1. Create a separate R2 bucket; never reuse the original-document bucket. Keep
   `r2.dev` disabled and attach no public custom domain.
2. Configure exactly two enabled expiry rules: `backups/` at 1,209,600 seconds
   (14 days), and `releases/` at 7,776,000 seconds (90 days). Configure matching
   age-based bucket locks with those same prefixes and durations. These policies
   apply only to the new destination. Lifecycle deletion can lag its target.
3. Set protected `preview` environment variable `KEEL_PREVIEW_BACKUP_BUCKET` to
   that bucket. Its existing `CLOUDFLARE_API_TOKEN` must support R2
   configuration reads and restricted temporary-credential issuance. Keep the
   API token and `KEEL_PREVIEW_BACKUP_PASSPHRASE` outside Git and maintain the
   recovery owner's offline passphrase copy. Do not broaden token permissions
   automatically.
4. Run exact-main post-merge verification and inspect the backup read-back step
   before migration, the terminal protected smokes and durable release record.
   Retain only non-sensitive proof in routine reports.

Every publication checks the bucket is private and has the expected retention
locks and expiry rules. It inventories all retained objects, including foreign
keys and objects awaiting expiry, under a 300 MiB destination budget. At most
five 1,000-item pages are read. Missing cursor metadata uses ordered keyset
continuation followed by an empty terminal page; a short page alone is not
completion. Malformed, duplicate, truncated or over-budget inventory fails
closed. The serialized deployment lane is the sole writer; do not add an
independent writer without atomic capacity admission. Backups and manifests must
fit whole within 16 MiB; release JSON is capped at 256 KiB. No remote deletion
is performed to obtain headroom.

The passphrase must be available to the recovery owner separately from R2
credentials. A verified ciphertext read-back is not a full restore drill:
periodically download an exact object pair in restricted staging, check the
ciphertext hash, decrypt with GPG and compare the plaintext hash, then restore
into a new non-production D1 database. Keep SQL, credentials and plaintext out
of worktrees and routine logs. Cloudflare D1 Time Travel and migration-time
backups are additional recovery layers. Production backup storage and approval
remain separate from this preview workflow.

### Protected storage preflight

Dispatch `preview-backup-storage-check.yml` on `main` to verify the actual
protected deployment credential before another export. The manual-only check
shares the serialized deployment lane and protected `preview` environment. It
checks privacy, retention and capacity, derives a 15-minute credential for one
exact key, then conditionally stores and fully reads back a constant synthetic
payload under `backups/probes/<sha>/<run-id>-<attempt>/synthetic-check.bin`. The
small canary counts toward capacity and expires under the existing 14-day backup
policy. It is not a D1 recovery point and creates no backup receipt. The check
never exports or changes D1, deploys Workers, reads the encryption passphrase,
or uploads GitHub artifacts. A passing probe does not replace the release's full
native gate, encrypted backup verification or protected smokes.

Failures print only a fixed phase, HTTP status and numeric Cloudflare or
allowlisted S3 error codes. Provider messages, bodies, object contents,
credentials and exception stacks are omitted. Use the phase/code to distinguish
policy reads, parent-token verification, temporary credential issuance and
object PUT/read-back. Do not infer a missing permission solely from a generic
failure, broaden permissions automatically, or bypass a failed backup gate.

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
disabled, loads child-before-parent D1 exports before running complete
foreign-key checks, and checks every recovered PDF's length and SHA-256 against
that metadata. It rejects duplicates, truncation, extra records, and
oversized/decompression output. No PDF is opened during restore checking.
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
   single-line encryption passphrase separate from the storage account. The file
   must contain exactly that passphrase, without a trailing newline.
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
