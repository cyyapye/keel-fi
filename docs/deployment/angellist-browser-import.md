# AngelList Mac agent

Keel uses a dedicated Chrome profile on the user's Mac to request AngelList's
investments CSV. The Mac keeps the AngelList and Cloudflare Access sessions;
neither browser cookies nor credentials are uploaded to Keel. Only the CSV is
sent to the authenticated Keel API, where it enters the existing holding-import
review flow.

Cloudflare Browser Run is retired for this workflow. The API Worker no longer
needs a Browser Rendering binding, AngelList KV namespace, cron trigger, stored
browser session, or AngelList-specific deployment secret.

## Trust boundary

- The Chrome profile lives at
  `~/Library/Application Support/Keel/AngelList Agent/Chrome` with owner-only
  directory permissions.
- Chrome's DevTools endpoint binds to loopback on a random nonzero port and uses
  this non-default profile. It is not exposed to the network.
- Credentials, passwords, magic links, 2FA codes, cookies, and local storage
  stay in the dedicated Chrome profile. The user enters authentication directly
  in Chrome.
- The Mac agent uploads only a bounded AngelList CSV through the authenticated
  Keel page. The API validates the file again before private R2 storage and D1
  staging.
- A completed agent run creates or reuses a pending holding import. It never
  applies holdings or forecasts. The user must review the import in Keel.
- D1 is canonical for registration, interval, heartbeat, run leases, failures,
  and completion state. Lease tokens are short-lived and only their SHA-256
  digests are stored.

The local profile has the same practical risk as another signed-in Chrome
profile on the Mac: malware or another process running as the same macOS user
could attempt to inspect or control it. Full-disk encryption, a locked macOS
account, and the dedicated read-only AngelList account remain required.

## One-time setup

Prerequisites:

- macOS with Google Chrome installed in `/Applications`;
- a stable checkout of this repository with dependencies installed;
- the read-only AngelList account with investments CSV export permission; and
- a Keel user authorized by Cloudflare Access for the same household.

From the stable checkout, run:

```bash
pnpm angellist:setup -- --keel-url https://keel-preview.example.com
```

or:

```bash
make angellist-setup KEEL_URL=https://keel-preview.example.com
```

Setup opens the dedicated Chrome profile. Finish Cloudflare Access sign-in, then
AngelList sign-in and any 2FA prompt in that window. Setup waits until the Keel
API is authenticated and the exact `Export CSV` button is visible. It then
registers the Mac in D1 and installs
`~/Library/LaunchAgents/com.keel.angellist-agent.plist`.

The LaunchAgent records only bounded operational events in:

- `~/Library/Logs/Keel/angellist-agent.log`
- `~/Library/Logs/Keel/angellist-agent.error.log`

The plist points to the checkout used during setup. Keep that checkout in place.
Rerun setup after moving the repository, changing the Keel origin, or changing
the Node/pnpm installation.

## Regular operation

The background process keeps Chrome available and polls Keel every 30 seconds.
It does not create scheduled work while the Mac is asleep or offline. When the
Mac next polls, D1 creates a due scheduled run if needed.

From Holdings, the user can:

- choose daily, weekly, or off;
- request `Run now` from a phone or desktop; and
- see Mac availability, last completion, next scheduled date, and bounded
  attention states.

`Run now` is safe when the Mac is offline: one active run remains queued until
the Mac returns. A lease lasts five minutes. Completion or failure advances the
next scheduled date so a broken sign-in cannot create a tight retry loop.

When AngelList or Keel authentication expires, the Holdings screen directs the
user to the dedicated Chrome window on the Mac. Complete sign-in and request
another run. A failed attempt never replaces a previously staged import or
changes accepted holdings.

## API routes

All routes require the normal user Cloudflare Access identity. Service-token
identities remain restricted to the deployment smoke route.

| Method | Route                                                      | Purpose                                                |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| `GET`  | `/api/automation/angellist/status`                         | Household-scoped overview for Holdings                 |
| `POST` | `/api/automation/angellist/run`                            | Queue one manual run; idempotent while a run is active |
| `POST` | `/api/automation/angellist/mac-agent/register`             | Register or heartbeat the authenticated Mac            |
| `PUT`  | `/api/automation/angellist/mac-agent/config`               | Set `daily`, `weekly`, or `off`                        |
| `POST` | `/api/automation/angellist/mac-agent/lease`                | Heartbeat and lease one queued or due run              |
| `POST` | `/api/automation/angellist/mac-agent/runs/:runId/complete` | Validate and stage one leased CSV                      |
| `POST` | `/api/automation/angellist/mac-agent/runs/:runId/fail`     | Record one bounded failure code                        |

The complete and fail routes require the raw lease token in
`X-Keel-Agent-Lease`. The CSV route accepts exactly one `file` multipart field
and retains the existing 1 MB and 500-row bounds.

## Deployment and verification

Migration `0009_angellist_mac_agent.sql` creates one agent per household and an
operational run history. Preview deployment still follows the normal encrypted
D1 backup, forward-only migration, API-before-web, and protected smoke order.
The smoke now checks D1, R2, Queue, and exact Worker metadata; it no longer
checks unused Browser Run or KV resources.

Before release:

```bash
make verify
```

Live acceptance is not complete until the real read-only account signs in from
the dedicated Chrome profile, an exact `Export CSV` click succeeds, the CSV
appears as a pending Keel import, and Holdings remains unchanged until review.

## Disable or reinstall

Choose `Off` in Holdings to stop automatic runs while preserving phone-triggered
`Run now`. To remove the background process entirely, unload and delete only
`~/Library/LaunchAgents/com.keel.angellist-agent.plist`; the dedicated Chrome
profile can then be archived or deleted separately after confirming no sign-in
needs to be retained.

Cloudflare Browser Run resources created for the retired design are not
referenced by the Worker after this release. They may be removed from the
Cloudflare account after preview deployment evidence confirms the new Worker has
no Browser Rendering or AngelList KV binding.
