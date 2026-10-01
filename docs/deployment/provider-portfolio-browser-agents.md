# Tokenfolio and Sydecar portfolio agents

Keel can read an authorized Tokenfolio or Sydecar investor portfolio from a
dedicated Chrome profile on macOS or an always-on Linux worker. This path is
intended for providers that do not offer a supported investor API or holding
export.

On macOS, each provider and Keel origin uses a separate Chrome profile and
LaunchAgent:

| Provider   | LaunchAgent label                      | Local Chrome profile                    |
| ---------- | -------------------------------------- | --------------------------------------- |
| Tokenfolio | `com.keel.tokenfolio-agent.<instance>` | `Tokenfolio Agent/Instances/<instance>` |
| Sydecar    | `com.keel.sydecar-agent.<instance>`    | `Sydecar Agent/Instances/<instance>`    |

Provider credentials remain in those local Chrome profiles. The agent does not
read cookies or passwords. A one-time Keel sign-in authorizes an opaque,
provider-scoped credential stored in macOS Keychain or a mode-`0600` Linux user
file; D1 stores only its SHA-256 digest. Daily checks submit directly to the
dedicated agent API hostname and do not reuse the Keel browser session. The CSV
exists only in memory and is discarded when the process exits.

An update records source evidence, then automatically accepts clear positions.
Only unresolved exceptions need review. Missing positions stay unchanged, and
routine baseline refreshes preserve the existing planning choices. See the
[source update policy](../architecture/source-update-policy.md).

## One-time setup

Run setup from the stable checkout used by the LaunchAgent:

```sh
make provider-agent-setup PROVIDER=tokenfolio KEEL_URL=https://keel.example.com
make provider-agent-setup PROVIDER=sydecar KEEL_URL=https://keel.example.com
```

Each command opens a dedicated Chrome window. Complete the provider sign-in,
including 2FA, then sign in to Keel once to approve that agent. Setup rotates
the provider-and-origin-scoped credential and installs the platform's background
service. Rerun setup after moving the checkout, changing Node or pnpm, when
Holdings reports that agent access needs renewal, or when the managed reconnect
service itself needs repair. An expired provider sign-in uses the reconnect flow
below and does not require setup.

Provider setup uses two phases because Google does not allow its sign-in flow
inside a software-controlled browser. The first dedicated Chrome window has no
browser-control flags. Sign in to the selected provider and Keel there, return
to Terminal, and press Enter. Setup closes that window, reopens the same
isolated profile for read-only checks, and verifies both sessions before
installing the schedule. Never enter a Google password or 2FA code after the
controlled window opens; rerun setup instead.

On a headless OVH worker, the same command creates a localhost-only temporary
desktop and prints the SSH tunnel needed to view it from a Mac. See
[Linux portfolio agents on an OVH worker](./linux-browser-agents.md) for the
one-time operator bootstrap and troubleshooting commands. Normal reconnects do
not expose these steps to the user.

Run setup separately from local and preview Holdings when both should stay
connected. Their jobs, Chrome profiles, credentials, and logs are independent,
so either environment can be reconfigured without replacing the other. The
former single-origin job is unloaded and removed only after its matching scoped
replacement installs successfully. All loopback URLs share one `local` slot, so
a new worktree port replaces only the previous local job and leaves preview
untouched.

Request an immediate update for one destination with:

```sh
make provider-agent-run PROVIDER=tokenfolio KEEL_URL=https://keel.example.com
make provider-agent-run PROVIDER=sydecar KEEL_URL=https://keel.example.com
```

The Holdings screen can set the import interval to daily, weekly, or off. The
Linux service checks for queued work once per minute; D1 controls the scheduled
capture interval. The macOS Tokenfolio job checks daily; Sydecar checks hourly
so a daily or weekly capture interval does not expire its saved sign-in. Empty
checks do not open a provider browser.

Sydecar closes its dedicated Chrome browser after each completed or failed
capture, setup verification, and reconnect verification. The next capture
reopens the same saved profile. Leaving Sydecar's page running between daily
captures lets its client-side inactivity timer sign out and erase the saved
login. Closing Chrome does not clear the profile, simulate activity, copy
credentials, or override provider-side expiry. An expired or revoked sign-in
still requires reconnecting. Tokenfolio keeps its existing browser lifetime.

Sydecar's refresh authorization currently lasts twelve hours. While scheduled
updates are enabled, the agent leases a separate session check six hours after
verified renewal or reconnect. Healthy captures keep any earlier check deadline;
a capture that recovers from an attempted renewal restarts the six-hour window
and retry counter together. The check briefly opens the ordinary provider page,
lets the provider renew its own session, checks expiry metadata, and closes
Chrome. This does not import holdings or change the capture interval. Transient
errors retry hourly, at most three times; an expired sign-in stops until
recovery. See the
[operating budget](../engineering/recurring-work-budgets.md#sydecar-session-maintenance)
for admission, deadlines and full-day costs. Upgrade both the API/web and the
existing worker; reinstall a macOS job to apply its hourly wake interval.

## Reconnect from Holdings

When Tokenfolio or Sydecar needs sign-in or 2FA, Holdings shows **Reconnect
[provider]**. Keel prepares a provider-scoped browser on the registered worker,
then opens it through a single-use HTTPS link. The user signs in to the provider
only; no terminal, SSH or VNC details, or second Keel login are shown.

The browser and stream expire after 15 minutes and are destroyed on success,
cancellation, failure, or timeout. The selected provider profile stays on the
worker, and the stream never exposes the underlying desktop or a public VNC
port. Keel stores no provider cookie, password, or 2FA value. A successful
reconnect rotates the machine credential, resumes updates, and requests an
immediate update. Clear positions update automatically; only unresolved
exceptions require review.

The manual repair command remains under **Troubleshooting** for worker or agent
failures. Provider sign-in expiry should not require it.

If a page could not be read, **Try update** and **Reconnect [provider]** remain
available as separate recovery actions. A page-reading failure alone does not
prove the sign-in expired. Keel recognizes a dedicated sign-in route together
with visible sign-in copy even when its form has not loaded. Reconnecting and
queuing an update are mutually exclusive while either request is in progress.

### Tokenfolio MFA and passkey changes

Enabling MFA or registering a passkey can invalidate a provider's older
sessions. Signing in through an ordinary browser does not renew the dedicated
agent profile. Use **Reconnect Tokenfolio**, complete the provider's required
steps in that browser, and wait for Keel to verify the saved session and the
immediate update. Confirm the next scheduled update also succeeds before
treating the session as durable.

On a remote Linux worker, a passkey stored on the user's Mac may not be
available to the worker's Chrome browser. A streamed browser does not forward
the Mac's platform authenticator. Use the provider's authenticator-code or other
supported sign-in alternative when offered. If Tokenfolio requires a passkey
that cannot be used from the worker, that sign-in method needs a
provider-supported recovery path or an agent on a device that can use the
passkey. Keep MFA enabled; do not copy credentials between profiles or automate
authentication challenges.

The agent recognizes explicit passkey sign-in buttons and visible MFA/passkey
challenges within an authentication form or dialog on Tokenfolio's own origin. A
dialog can block a still-visible portfolio. Optional inline security settings,
hidden controls, unrelated origins, and missing portfolio controls alone do not
establish a sign-in requirement. This detection routes failures to the existing
reconnect flow; it does not establish Tokenfolio's session lifetime or renew a
revoked sign-in.

## Capture contracts

The agent fails closed if a provider page changes, a visible count changes
during capture, a required field is missing, money cannot be parsed as exact
integer cents, or two positions produce the same identity.

### Tokenfolio

- Reads the `Active Holdings` tab only.
- Accepts only the observed active-row statuses `Active`, `Funds Received`, and
  `Completed`; any other status fails closed.
- Requires the tab count to equal the visible holding rows before and after the
  capture.
- Opens every row and requires the company, committed amount, and current value
  to reconcile with its detail drawer.
- Uses the detail `Entity` and `Committed On` fields for ownership and date.
- Treats the active holding's committed amount as funded and committed capital.
- Keeps a missing current value as `not_reported`; it never substitutes zero.
- Keeps management fee and carry unavailable because the active cards and
  position drawer do not expose exact deal-specific rates. General product
  disclosures are not position evidence.
- Creates a provider-scoped identity from company, entity, and committed date.

[Tokenfolio describes its model](https://www.tokenfolio.co/faqs) as grouping
investors into an investing vehicle and managing the investment over its
lifetime. Keel therefore labels these as private vehicle interests without
claiming the exact legal vehicle name.

### Sydecar

- Reads only the visible desktop investments table after its row count is stable
  across multiple passes.
- Reconciles each funded table row before opening its stable detail URL, then
  requires the detail commitment to match. Detail titles may differ from the
  table's investment label.
- Uses the detail funded amount and `Initial investment` activity date when
  reported. On the alternate documents layout, the already-reconciled table
  funded amount remains evidence and the investment date stays `not_reported`.
- Maps `Closed` and `Participating In` to a live Keel position. A closed Sydecar
  vehicle is funded; it is not evidence that the investor realized the asset.
- Captures the visible management-fee and carry percentages as source evidence
  and reconciles them across the stable table passes. Missing or malformed terms
  fail closed.
- Keeps those reported percentages pending after the holding import is accepted.
  Position detail prefills them for a separate fee-and-carry review; the fee
  term still has to be confirmed against the deal documents before the terms
  affect cost basis or return.
- Leaves current value `not_reported` because the investor page does not provide
  one.
- Uses the provider position identifier for collision detection without writing
  it to logs.

### Legal-entity name evidence

- AngelList's `Fund Name` is the only current browser-agent field that Keel
  treats as a provider-reported legal-entity name.
- Tokenfolio and Sydecar position labels remain useful source references, but
  they are not legal-name evidence and never prefill or enter the reviewed
  legal-entity inventory as legal names.
- The existing Sydecar and Tokenfolio agents follow the investment's agreement
  controls and download subscription and operating/series agreements. Tax forms,
  wire instructions, and unrelated documents are excluded. A generic external
  platform login is not a position identity and is never matched by company
  name.
- Tokenfolio waits for the preceding drawer URL to clear and the current
  drawer's investment ID to appear before following its Deal Snapshot. Detail
  text can render before these route transitions; it is not URL readiness.
- Extraction uses Poppler only inside the [isolated PDF reader](pdf-sandbox.md).
  Provision and verify its rootless runtime before updating the agent checkout.
  No external AI, source text in logs, documents in Git, or unrestricted
  fallback.
- Explicit issuer/fund definitions supply the exact name, with document SHA,
  original filename, page, and quote. A cover title is used only when no
  explicit definition or parent/master definition is present. Investor,
  administrator, parent, underlying-company, and filename labels never supply a
  guessed legal name. Compartment/certificate structures remain distinct from
  direct LLC interests.
- Extraction version 2 recognizes a wrapped parent-agreement qualification after
  a complete fund name. It does not join a split name or normalize differing
  source names. Version 1 observations remain readable and are rechecked within
  the existing download budget after upgrade.
- Version 3 retains up to eight exact-name alternatives per agreement, including
  their roles, pages, and quotes. More alternatives leave an explicit limit
  result; they are never silently truncated into a resolved name. The existing
  six-document position limit and download/scan budgets are unchanged. Version 1
  and 2 observations remain readable and are rechecked by ordinary source
  updates; no provider reconnect is needed solely for this upgrade.
- Conflicting names have an explicit **Resolve name** action. Nothing is
  preselected. A user may choose a reported name, supply a document-backed
  correction with an excerpt and reason, link an exact existing entity, or leave
  the source unresolved. Security-blocked documents never become review choices.
  Old conflicts without saved alternatives can be corrected from a document or
  refreshed through a normal source update.
- Migration `0049` stores the chosen name and the exact original evidence with
  the immutable source-review decision. Deploy it before the API/web changes,
  then update the existing agents for version 3 extraction. Evidence revisions
  reject stale submissions; the source identity/version prevents duplicate
  decisions, and a commit-time check rejects a concurrently renamed target.
  Future observations do not rewrite the reviewed name or its receipt. CSV
  distinguishes reviewed choices, user corrections, and unresolved alternatives.
  Inventory reads remain projection-only with no PDF/R2 reads or row-by-row
  queries; 120-source receipt coverage uses the four-query repository budget.
- Version 4 preserves an explicit compartment clause with exact party names,
  roles, pages, quotes, and an explicit equity-certificate title when present.
  The representative is not a selectable invested name. Entity type defaults to
  `Other`, but the reviewer can select the legal form stated in the agreement.
  This is a user classification, not inferred direct ownership. Original roles,
  the reported interest, and the reviewed type remain in the source receipt and
  default counsel export. Unrecognized clauses permit an exact manual name and
  page with an optional excerpt. Migration `0052` replaces the `0051` Other-only
  restriction with a commit-time check against the type recorded at review;
  concurrent renames and type changes still reject the source link. Deploy the
  migration before the API/web. Earlier receipts remain unchanged and readable;
  old API writes still require `Other` during rollout. No agent upgrade or
  provider reconnect is needed for this review-form change.
- A clean agreement with an unrecognized name or reader limit now permits
  **Review PDF**: download the existing private original, then supply its exact
  name, page, excerpt, and reason. No guessed legal name is prefilled. A stale
  evidence revision or a blocked selected document fails closed. Existing
  version 1–3 observations remain readable; ordinary bounded source updates
  re-extract older versions after the agent upgrade. These updates still use the
  existing provider download flow; they do not parse R2 objects on a GET.
- All source review actions open in the source row. The attention queue precedes
  reviewed records: manual PDF/structure review, conflicting names, found names,
  then sources waiting on documents. These are explicit evidence categories, not
  calibrated confidence percentages. Stable name/source-key ordering breaks
  ties. Lists render 25 rows at a time with scroll loading and a button
  fallback; loading more preserves open drafts. The API still returns one
  complete inventory projection, so exports never depend on rendered rows.
- Direct entity navigation preloads only `/api/legal-entities`; it does not wait
  for Holdings or planning. Independent entity and position reads start
  together. The combined read uses eight row-count-independent D1 round trips,
  with indexed 120+ item regressions and a 500-source browser case. There are no
  provider requests, object reads, backfills, or writes on this GET path.
- Originals are deduplicated by household and SHA in private R2. Names are
  evidence for the existing exact-batch add, never automatic acceptance.
  Missing, unreadable, inaccessible, conflicting, changed-page, and safety-limit
  states remain explicit in the inventory and counsel export.
- Ownership-container labels are also references only. An LLC or LP suffix in a
  label does not make that label legal-name evidence.

### Agreement backfill and recovery

Deploy migration `0047` and the API before updating existing provider agent
services. No new connector, account, credential, schedule, or second worker is
required. Queue a normal source update to backfill accepted positions. Reconnect
the existing agent only if its provider session has expired.

The Linux service checks for queued work every minute; D1 still determines when
daily or weekly portfolio captures are due. A queued update does not need a
service restart. This adds at most 1,440 bounded lease checks per provider per
day. These are lease checks, not provider captures. Reconnect discovery shares
the same one-minute idle clock, adding at most 1,440 checks per provider per
day. Activity timestamps advance at most every five minutes. Active reconnects
poll every five seconds for at most 15 minutes, and failed idle checks back off
to 15 minutes. The combined
[operating budget](../engineering/recurring-work-budgets.md) includes
authentication and both Worker invocations.

The agent scans the document controls on every normal capture. Sydecar's current
layout is read from one centralized Documents page for every position after the
full position list reconciles; only exact, unique Investment-label matches may
be associated, and the page is rejected above 5,000 document rows. This includes
positions whose older detail page omits a governing agreement. The older
per-investment controls are a fallback only when no central controls match and
the exact detail URL was already reconciled. Central controls finish first;
there is at most one legacy navigation per unmatched position and exactly one
evidence capture per position. A new identity is read first; existing originals
become eligible for recheck after seven days. Remaining download capacity
rechecks the oldest originals first, so expired caches cannot starve a larger
first-time backfill. Deferred rechecks preserve the original check date. No
signed download URL or query is persisted. New sources beyond the run budget
resume on the next normal update.

Budgets: 500 positions, six PDFs / 16 MiB per position, 8 MiB / 150 pages / 1
MiB extracted text per PDF, 24 downloads / 64 MiB per run, serial provider
navigation, and a hard 30-minute run lease. The server reserves upload bytes
before R2 writes, atomically across retries. Source-content failures do not
block holding capture; API/lease/storage failures fail the run explicitly.
Document observations are submitted only after complete-snapshot identity checks
pass.

An interrupted storage save retries the same run, capture digest, and content
hash; expired or terminal leases cannot be revived. A new run can safely retry
the deterministic private key. Older observations cannot replace newer evidence.
No document fetch, repair, or backfill occurs on inventory/holdings GET paths.

Recovery: queue an update after restoring access or verifying the PDF sandbox;
request a searchable, size-limited PDF for unreadable/oversized documents; ask
the provider for the precise legal vehicle and governing agreement when absent
or conflicting. The bounded backfill does not assert that every provider-held
document has been found, or that a reported vehicle establishes trust ownership.

## Operational state

D1 stores only the household-scoped provider, interval, heartbeat, leases,
completion timestamps, pending import identifier, bounded error code, reconnect
lifecycle, and device-token digest. It retains a temporary HTTPS destination
only until the user opens it. Automatic rotation overlaps the old and
replacement token until the replacement is stored and used; setup still revokes
prior tokens immediately. Run, reconnect, and credential history cannot be
deleted or reassigned to another household or provider.

The agent logs only its provider and bounded failure code. It must not log page
text, provider identifiers, holdings, entities, dates, or amounts.

The Holdings screen distinguishes:

- setup required;
- ready or working;
- queued or running;
- agent check overdue;
- provider sign-in expired or agent access needs renewal;
- provider page changed;
- incomplete snapshot;
- ambiguous position identity; and
- upload or unexpected failure.

Provider authentication failures expose a managed reconnect. Worker and agent
failures expose the manual command only under troubleshooting. Any failure
leaves accepted holdings unchanged.

The device token can only queue, lease, fail, complete, or record agreement
evidence for a run for its exact provider. It cannot download originals, read
holdings, configure the schedule, authorize another device, review an import, or
apply a change.
