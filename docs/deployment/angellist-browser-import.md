# AngelList portfolio agent

Keel uses a dedicated Chrome profile on macOS or an always-on Linux worker to
request AngelList's investments CSV. The update computer keeps the AngelList
session; neither browser cookies nor credentials are uploaded to Keel. A
one-time Cloudflare Access sign-in authorizes a target-scoped machine
credential. Daily checks use it to send only the CSV to Keel's dedicated agent
API, where it enters the existing holding-import review flow.

Cloudflare Browser Run is retired for this workflow. The API Worker no longer
needs a Browser Rendering binding, AngelList KV namespace, cron trigger, stored
browser session, or AngelList-specific deployment secret.

## Trust boundary

- Each Keel origin gets its own owner-only Chrome profile. macOS stores it under
  `~/Library/Application Support/Keel/AngelList Agent/Instances/<instance>/Chrome`;
  Linux stores it under `~/.local/state/keel/portfolio-agents`.
- Chrome's DevTools endpoint binds to loopback on a random nonzero port and uses
  this non-default profile. It is not exposed to the network.
- Credentials, passwords, magic links, 2FA codes, cookies, and local storage
  stay in the dedicated Chrome profile. The user enters authentication directly
  in Chrome.
- The account-scoped portfolio dashboard URL is captured after sign-in and
  stored only beside that origin's Chrome profile as `config.json`, with
  owner-only permissions. It is not uploaded to Keel or checked into the
  repository.
- The agent uploads only a bounded AngelList CSV to the dedicated agent API. It
  does not need a Keel browser session after setup. The API validates the file
  again before private R2 storage and D1 staging.
- The supported export's `Carry` percentage is normalized as position evidence.
  The export does not report a management fee, so that field stays unavailable;
  neither term affects position economics until the user reviews the complete
  deal terms in Keel.
- Repeating a byte-identical export can add newly supported carry parsing to its
  retained source row. Keel appends that evidence without rewriting the import,
  its accepted position, or its financial snapshot.
- A completed agent run creates or reuses a holding import. It never applies
  holdings or forecasts. The user must review a new import in Keel.
- D1 is canonical for registration, interval, heartbeat, run leases, failures,
  and completion state. Lease tokens are short-lived and only their SHA-256
  digests are stored.
- The long-lived machine credential is scoped to AngelList agent routes, stored
  in macOS Keychain or a mode-`0600` Linux user file, and represented in D1 only
  by a SHA-256 digest. A successful managed reconnect rotates it with a safe
  overlap; rerunning setup revokes prior credentials immediately.

The local profile has the same practical risk as another signed-in Chrome
profile: malware or another process running as the same operating-system user
could attempt to inspect or control it. Host encryption, a locked account, and
the dedicated read-only AngelList account remain required.

## One-time setup

macOS prerequisites:

- macOS with Google Chrome installed in `/Applications`;
- a stable checkout of this repository with dependencies installed;
- the read-only AngelList account with investments CSV export permission; and
- a Keel user authorized by Cloudflare Access for the same household.

From the stable checkout, run:

```bash
make provider-agent-setup PROVIDER=angellist KEEL_URL=https://keel-preview.example.com
```

Setup opens the dedicated Chrome profile. Finish AngelList sign-in and any 2FA
prompt, then sign in through Cloudflare Access once to approve the agent. Setup
waits until the exact `Export CSV` button is visible, stores the returned opaque
credential in Keychain without an interactive password-data prompt, records the
current account-scoped `/v/.../i/.../portfolio/dashboard` route locally, and
installs a destination-scoped
`~/Library/LaunchAgents/com.keel.angellist-agent.<instance>.plist`.

On a headless OVH worker, the same command starts a localhost-only temporary
desktop and prints the SSH tunnel needed to view it from a Mac. Follow
[Linux portfolio agents on an OVH worker](./linux-browser-agents.md) for the
operator-only bootstrap, fallback sign-in steps, and `systemd` operations.
Normal reconnects are managed from Holdings without SSH or VNC instructions.

The LaunchAgent records only bounded operational events in origin-scoped files:

- `~/Library/Logs/Keel/angellist-agent-<instance>.log`
- `~/Library/Logs/Keel/angellist-agent-<instance>.error.log`

The plist points to the checkout used during setup. Keep that checkout in place.
Rerun setup after moving the repository or changing the Node/pnpm installation.
Run setup once for every Keel origin that should receive updates. Each origin
keeps an independent schedule, Keychain credential, Chrome profile, config, and
logs. Installing one no longer replaces another. When the matching scoped job is
installed, setup unloads and removes the former single-origin plist. Loopback
URLs share one `local` slot, so moving development to another local port
replaces only the prior local job and never the preview job.

For example, local development and preview can coexist:

```bash
make provider-agent-setup PROVIDER=angellist KEEL_URL=http://127.0.0.1:5422
make provider-agent-setup PROVIDER=angellist KEEL_URL=https://keel-preview.example.com
```

## Regular operation

launchd starts a short-lived macOS check once every 24 hours. On Linux, a
long-running `systemd --user` service stays available for managed reconnects
after SSH disconnects and checks for portfolio update work once daily. Both
reuse the AngelList Chrome profile and target-scoped credential. When an agent
next checks for update work, D1 creates a due scheduled run if needed.

From Holdings, the user can:

- choose daily, weekly, or off;
- queue an update from a phone or desktop for the next daily agent check; and
- reconnect AngelList in a short-lived private browser when sign-in or 2FA is
  required; and
- see the last agent check, last completion, next scheduled date, and bounded
  attention states.

**Reconnect AngelList** requests a provider-scoped browser on the registered
worker and opens it through a single-use HTTPS link. The user enters only the
AngelList sign-in and 2FA. Keel does not show a terminal, SSH tunnel, VNC URL or
password, or a second Keel sign-in. The underlying display and VNC service stay
on loopback, while the temporary outbound HTTPS stream expires after 15 minutes
and is destroyed after success, cancellation, failure, or timeout.

The AngelList profile, cookies, and passwords remain on the worker. Keel stores
only the bounded reconnect lifecycle and erases the temporary destination when
it is opened. On success, the agent rotates its own Keel credential, queues an
immediate update, and closes the stream. The resulting import still waits for
review. The setup command remains available only under troubleshooting for
worker or agent failures.

To run the complete flow for one destination immediately instead of waiting for
its next daily check:

```bash
make provider-agent-run PROVIDER=angellist KEEL_URL=https://keel-preview.example.com
```

The command reuses the signed-in Chrome profile, queues one idempotent run,
downloads the CSV, and uploads it to Keel as a pending import. It never applies
the import. If an update was already queued from a phone, the same command picks
it up immediately.

Queueing an update is safe when the agent is offline: one active run remains
queued until the next daily check or local command. A lease lasts five minutes.
Completion or failure advances the next scheduled date so a broken sign-in
cannot create a tight retry loop.

When AngelList authentication expires, Holdings shows **Reconnect AngelList**.
When agent access is rejected or missing, use the setup command under
troubleshooting. A failed attempt never replaces a previously staged import or
changes accepted holdings.

## API routes

Status, configuration, user queueing, and authorization require the normal user
Cloudflare Access identity. The device credential is accepted only on the
dedicated agent hostname and only for the machine routes below.

| Method | Route                                                      | Purpose                                                |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------ |
| `GET`  | `/api/automation/angellist/status`                         | Household-scoped overview for Holdings                 |
| `POST` | `/api/automation/angellist/run`                            | Queue one manual run; idempotent while a run is active |
| `POST` | `/api/automation/angellist/mac-agent/register`             | Register or heartbeat the authenticated agent          |
| `POST` | `/api/automation/angellist/mac-agent/authorize`            | Rotate and return one machine credential               |
| `PUT`  | `/api/automation/angellist/mac-agent/config`               | Set `daily`, `weekly`, or `off`                        |
| `POST` | `/api/automation/angellist/mac-agent/run`                  | Queue one device-requested run                         |
| `POST` | `/api/automation/angellist/mac-agent/lease`                | Heartbeat and lease one queued or due run              |
| `POST` | `/api/automation/angellist/mac-agent/runs/:runId/complete` | Validate and stage one leased CSV                      |
| `POST` | `/api/automation/angellist/mac-agent/runs/:runId/fail`     | Record one bounded failure code                        |

Managed reconnects add user-authenticated create, status, cancel, and one-use
open routes under `/api/automation/provider-browser`. The corresponding machine
routes can lease only the exact provider's request, report readiness and
completion, fail it with a bounded code, or rotate that provider's credential.
The temporary stream URL is never returned by a status route.

The complete and fail routes require the raw lease token in
`X-Keel-Agent-Lease`. The CSV route accepts exactly one `file` multipart field
and retains the existing 1 MB and 500-row bounds.

The device credential cannot call status, config, authorize, review, or apply
routes. Its raw value is returned once, never logged, never placed in background
service arguments, and never stored in D1.

## Deployment and verification

Migration `0009_angellist_mac_agent.sql` creates one agent per household and an
operational run history. Migration `0034_mac_agent_credentials.sql` adds
revocable, digest-only device credentials. Migration
`0042_provider_browser_sessions.sql` adds the provider-scoped, append-only
reconnect lifecycle, and `0043_mac_agent_credential_rotation.sql` adds safe
overlap for automatic rotation. Preview deployment still follows the normal
encrypted D1 backup, forward-only migration, API-before-web, and protected smoke
order. The smoke now checks D1, R2, Queue, and exact Worker metadata; it no
longer checks unused Browser Run or KV resources.

Before release:

```bash
make verify
```

Live acceptance is not complete until the real read-only account signs in from
the dedicated Chrome profile, an exact `Export CSV` click succeeds, the CSV
appears as a pending Keel import, and Holdings remains unchanged until review.

## Disable or reinstall

Choose `Off` in that environment's Holdings screen to stop automatic runs while
preserving queued updates and the run command. To remove one background process
entirely on macOS, unload and delete only its
`~/Library/LaunchAgents/com.keel.angellist-agent.<instance>.plist`. On Linux,
disable only the exact unit printed by setup with
`systemctl --user disable --now <unit-name>`. Its scoped Chrome profile can then
be archived or deleted separately after confirming no sign-in needs to be
retained.

Cloudflare Browser Run resources created for the retired design are not
referenced by the Worker after this release. They may be removed from the
Cloudflare account after preview deployment evidence confirms the new Worker has
no Browser Rendering or AngelList KV binding.
