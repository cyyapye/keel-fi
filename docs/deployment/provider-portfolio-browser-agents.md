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

An update only creates a pending holding import. It never applies a holding,
removes a missing position, or changes a forecast without review.

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
Linux service stays available for managed reconnects and checks for queued or
scheduled portfolio updates once per day. The macOS job remains a daily check.

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
immediate update. The result is still a pending holding import that requires
review.

The manual repair command remains under **Troubleshooting** for worker or agent
failures. Provider sign-in expiry should not require it.

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
- Extraction uses local Poppler (`brew install poppler` on macOS,
  `poppler-utils` on Linux). Install it on the agent service PATH before
  updating the agent checkout. No external AI, source text in logs, or documents
  in Git.
- Explicit issuer/fund definitions supply the exact name, with document SHA,
  original filename, page, and quote. A cover title is used only when no
  explicit definition or parent/master definition is present. Investor,
  administrator, parent, underlying-company, and filename labels never supply a
  guessed legal name. Compartment/certificate structures are flagged for
  provider or counsel clarification, not called LLCs.
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

The agent scans the document controls on every normal capture. A new identity is
read first; existing originals become eligible for recheck after seven days.
Remaining download capacity rechecks the oldest originals first, so expired
caches cannot starve a larger first-time backfill. Deferred rechecks preserve
the original check date. No signed download URL or query is persisted. New
sources beyond the run budget resume on the next normal update.

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

Recovery: queue an update after restoring access or installing Poppler; request
a searchable, size-limited PDF for unreadable/oversized documents; ask the
provider for the precise legal vehicle and governing agreement when absent or
conflicting. The bounded backfill does not assert that every provider-held
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
