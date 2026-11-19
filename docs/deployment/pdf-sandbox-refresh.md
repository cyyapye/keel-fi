### Explicit local scanner refresh

When the runtime is already configured, run `make pdf-sandbox-refresh` to
refresh this worktree's scanner and the registry used by future worktrees. This
explicit maintenance command downloads signed official packages and FreshClam
databases through the existing scanner-only builder. It uses the validated
existing socket, rejects CI and service-config overrides, and refuses
overlapping wrapper refreshes for the same daemon. Do not run another manual
build, registry update, or local PDF verification concurrently.

The builder proves a real clean synthetic scan before the wrapper atomically
adopts the scanner. Reader and probe bindings remain unchanged. A build or
preflight failure preserves the active binding. If registry publication fails
after local adoption, the command explicitly reports that partial success. Other
existing worktrees keep their own pins. No VM is started or reconfigured.

Then run `make provider-document-runtime-verify` and `make pdf-sandbox-verify`.
The 72-hour vendor-signature freshness rule remains unchanged. Readiness checks
prove engine and image availability, not signature freshness. An unavailable
scan can also mean an interrupted ownership journal or other infrastructure
problem; it must not be labelled expired or repeatedly rebuilt without
diagnosis. Follow the existing documented interruption recovery rather than
deleting an ownership journal merely because it appears old.

This is on-demand maintenance, not a background schedule or an automatic
verification fix.

### On-demand local provider preparation

The default macOS provider collector prepares the scanner before an uncached PDF
scan. Linux services, CI, explicit service-config overrides, `make verify` and
ordinary readiness checks do not enable this adapter. No background job is
installed. It never receives a document in its maintenance commands.

Automatic preparation requires an owner-only receipt for the exact immutable
scanner image, canonical daemon socket and reviewed factory sources. The receipt
records a genuine admitted clean synthetic scan, including the worker-reported
vendor database timestamp. It is local trusted-install evidence, not a vendor
signature or a configurable freshness exemption. Its checksum detects
corruption, not a malicious actor with the same user's ability to replace code
and private state. Unknown installations are not enrolled automatically. The
initial known installation must be enrolled once from a new genuine clean proof;
subsequently only the official build's successful clean preflight produces new
receipts.

Every use validates the current receipt and recomputes the unchanged 72-hour
age. A confirmed stale timestamp is checked again under publication locks. One
build attempt is permitted per collector operation. Missing, mismatched,
corrupt, future-dated or source-stale receipts never initiate downloads; use the
explicit reviewed maintenance command instead. A failed scan never triggers a
rebuild.

A nonblocking check of the existing document owner refuses an occupied or dirty
runtime before building. It does not reserve capacity: later scans can overlap
an immutable-image build. Builds retain the existing 300-second limit and may
consume shared VM resources. No claim of zero resource contention is made.
In-flight scans retain their selected image; the candidate's clean preflight
uses ordinary admission, with no nested owner or relaxed scanner limits. The
worker's independent freshness check still gates every actual document.

All supported local publication writers use the same publication and daemon
locks. The new receipt is published before its scanner binding: a crash between
files creates an identity mismatch that disables automatic preparation, never a
false clean scan. Reader/probe bindings are not switched by automatic refresh. A
host registry deliberately selecting another runtime is preserved. Bootstrap
copies a matching receipt only where it can do so without overwriting
conflicting local evidence. Missing evidence remains explicit.

### Interrupted maintenance

Before any local official build, a private per-daemon pending marker is written.
A successful Docker build records its completion separately from the scan proof.
A later known preflight/non-adoption failure can clear the marker because build
completion is proved. An unconfirmed timeout or hard interruption leaves the
marker in place; subsequent automatic or manual builds refuse to duplicate it.
Ordinary scans still use their existing independent worker and owner policy.

`make pdf-sandbox-refresh-status` only inspects this maintenance state.
`make pdf-sandbox-refresh-reconcile` can archive and clear a marker only when
its matching build-completion record exists. It never changes bindings, starts a
service, removes containers, or resets the document owner's journal. If build
completion remains unconfirmed, it refuses to clear anything; inspect and
reconcile the exact prior build as an operator. Do not delete a marker merely
because it is old or a process is missing.
