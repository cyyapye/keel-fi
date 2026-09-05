# Private agreement storage baseline

This is the minimum for the current owner-only deployment, not a claim of
managed-service readiness or perfect malware detection. It covers the Sydecar
and Tokenfolio agreement PDFs, their D1 metadata, and their owner downloads.
Other R2 objects, such as encrypted provider credentials and raw import files,
are not included in the PDF recovery archive.

## Access and original preservation

- Keep R2 `r2.dev` access disabled and attach no public custom domain. R2's
  encrypted storage does not replace application authorization.
- The Worker resolves the authenticated owner and household in D1 before any
  object read. Provider machine credentials can upload only within their own
  provider's live lease; they cannot download documents or accept holdings.
- Originals use opaque household/hash keys. New PDFs stay under the private
  `quarantine/legal-entity-documents/` prefix even after scanning. Moving an
  object is not the release mechanism: D1's exact-hash clean scan is.
- Missing, blocked, stale-at-scan, malformed, or failed scan results never grant
  download access. Existing originals are not grandfathered into a clean state.
  The next bounded source update re-downloads and scans them. It preserves prior
  accepted records and does not infer a legal name.
- An authorized `POST /api/legal-entity-documents/:id` records the access before
  streaming bytes. The final authorization and audit use the current exact-hash
  scan in one database statement, so a block arriving during storage retrieval
  denies release. Failed audit writes fail closed. Attachment, no-store,
  nosniff, and sandbox headers remain in place. The former GET does not download
  or write anything; older open browser tabs may need one reload after
  deployment.

The scanner is an additional check, not a guarantee that a PDF is harmless. The
existing isolated PDF reader remains mandatory after a clean scan. See
[the scanner and reader boundary](../deployment/pdf-sandbox.md).

## Private access history

`private_document_access_events` records an opaque document ID, household, owner
identity, owner-versus-provider actor kind, action, outcome, and time. Upload
metadata and its event commit together. Downloads include released, denied, and
unavailable outcomes. "Released" means the server authorized a response, not
that a browser saved it. Unauthenticated requests are denied by the existing
auth boundary; there is no invented user identity for them.

These records remain inside private D1 and its encrypted backups. They do not
include names, signed links, content, or credentials in ordinary application
logs. The history is append-only. There is no new public audit-list endpoint.
Provider attribution identifies the authorized owner/provider class, not a
cryptographic proof against a compromised agent host.

Scan projections advance only with a successfully recorded observation, never
from a conflicting retry. Timestamps are normalized before persistence; a
blocked verdict wins an equal-time tie. A later successful rescan can recover
the exact same original without modifying accepted financial records.

## Credentials and operator prerequisites

- Require MFA/passkeys for the Cloudflare account, GitHub account, and the
  identity accepted by Keel's Access policy. Verify the actual identity/policy;
  an account-wide enforcement flag is not proof of the individual's MFA state.
- Keep production authentication fail-closed and Access restricted to the owner.
- Agents hold only their provider-scoped machine credentials. Never give them
  the deployment token, backup key, or backup bucket credentials.
- Backups use a separate D1 read token, an S3 Object Read token restricted to
  the original bucket, and a different S3 Object Read & Write token restricted
  to the backup bucket. Cloudflare REST object permissions require broader
  account access and are intentionally not used for this job.
- Store secrets in the protected `private-backup` environment, never Git or
  workflow artifacts. Keep an offline recovery copy of the encryption passphrase
  separate from R2 and verify the recovery owner can retrieve it.

## Retention and deletion

Original PDFs have no automatic expiry. Do not apply the backup lifecycle to the
originals or quarantine prefix. Existing temporary-upload cleanup is separate.
Backup policy is a daily encrypted recovery point with a proposed 14-day expiry
on the separate bucket's `daily/` prefix, activated only after owner approval.
See [backup activation and recovery](../deployment/backup-and-recovery.md).

No delete API or automated original deletion is introduced. For an explicit
owner deletion request, resolve the exact household/document IDs privately,
identify their dependent evidence, obtain approval for that exact scope, delete
only the named R2 object, verify absence, and record the private deletion event
while metadata still exists. Preserve accepted decision history and a tombstone
rather than silently rewriting it. Distinguish attempted deletion from confirmed
deletion; do not log `deleted` before R2 absence is confirmed. This requires a
reviewed operator operation, not a general-purpose SQL snippet.

After confirmed original deletion, older backups can still contain the bytes
until their 14-day lifecycle runs. Disclose that delay; don't promise immediate
erasure or silently delete unrelated backups. Audit metadata remains for the
life of this private deployment unless a separately reviewed retention policy is
approved. Managed multi-user service launch needs its own retention, account
deletion, tenant isolation, recovery, and abuse-response review.

## Rollout acceptance

1. Run `make verify`, including real clean/antivirus isolation proofs and
   desktop/mobile download flows. Do not update snapshots to mask a failure.
2. Verify owner MFA, bucket public-access settings, and narrow credential scope.
3. Deploy the D1 migration/API/web together through the exact-SHA release lane.
   Downloads without a recorded clean scan intentionally remain unavailable.
4. Build and prove each provider's scanner under its actual OVH service
   identity, activate its immutable image, install its daily refresh timer, and
   verify a source update records clean/blocked outcomes without changing
   accepted data.
5. Approve and configure the separate private backup bucket and 14-day backup
   lifecycle. Enable the daily workflow only after a private first-run restore
   and encrypted read-back succeed. A checked-in job is not a live backup.
6. Inspect failed jobs and timers. A missed run must be treated as a recovery
   coverage gap, never reported as a successful backup or a missing agreement.

References:
[R2 data security](https://developers.cloudflare.com/r2/reference/data-security/),
[public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/),
[bucket-scoped S3 tokens](https://developers.cloudflare.com/r2/api/tokens/),
[R2 audit-log limitations](https://developers.cloudflare.com/r2/platform/audit-logs/).
