# Linux portfolio agents on an OVH worker

Keel can run the AngelList, Tokenfolio, and Sydecar portfolio agents on an
always-on Linux worker. The worker keeps the provider sessions, stays available
for managed reconnect requests, and performs captures on the configured
schedule, so updates do not depend on a Mac staying awake.

The agent still has the same review boundary: each successful check creates a
pending import. It cannot accept a position, remove a missing position, or
change a forecast.

## What runs on the worker

Each provider receives its own non-login Linux identity and mode-`0700` home:

- `keel-angellist` at `/var/lib/keel-agents/angellist`;
- `keel-tokenfolio` at `/var/lib/keel-agents/tokenfolio`; and
- `keel-sydecar` at `/var/lib/keel-agents/sydecar`.

Each provider and Keel origin then receives its own:

- Chrome profile under its provider home;
- mode-`0600` machine credential under its provider home;
- long-running system `systemd` service running as only that provider identity;
  and
- provider-scoped API access that can only manage its reconnect lifecycle,
  rotate its own credential, or queue, lease, fail, and complete an import run.

The three UIDs cannot read each other's profile, cookies, or machine credential.
Each service also masks both sibling homes, so a service sandbox cannot reach
them even if filesystem permissions drift. The shared checkout is read-only to
all three identities and contains no provider state.

The service runs Chrome headlessly after setup. The one-time sign-in uses a
normal Chrome window in a private virtual desktop so Google and provider 2FA do
not run inside a software-controlled browser.

Tokenfolio and Sydecar checks open Chrome only after acquiring a capture or
session-maintenance lease. Sydecar shuts down its owned browser after capture or
sign-in verification, including failure, and reopens the same profile for the
next leased capture. Its page must not remain open between daily captures: the
page's inactivity timer can erase the saved login. The worker stays available
for reconnects while Chrome is closed.

## Prepare the worker once

Use a dedicated deployment user such as `keel-agent` for Git and dependency
updates. Do not run Chrome or a provider agent as root or as the deployment
user.

Install:

- Node.js 22.13 or newer and pnpm 11.9;
- the [rootless PDF sandbox](pdf-sandbox.md) for agreement-name extraction;
  native `poppler-utils` on the host is neither used nor a supported fallback;
- Google Chrome Stable (preferred) or a supported Chromium package; and
- `xvfb`, `x11vnc`, `xauth`, `novnc`, and `websockify` from the Linux
  distribution; and
- `cloudflared` on the service `PATH` for the temporary outbound HTTPS
  connection.

If the worker uses default-deny egress, allow outbound TCP and UDP port `7844`
only to Cloudflare's documented Tunnel endpoints. HTTPS port `443` alone can
allocate a temporary hostname, but it cannot establish the tunnel connection.
Keep all inbound ports closed. On the hardened `keel-agents` namespace, install
the checked-in rule helper and systemd drop-in:

```sh
sudo install -m 0755 scripts/linux-agent-cloudflare-egress.sh \
  /usr/local/libexec/keel-agent-cloudflare-egress
sudo install -d -m 0755 \
  /etc/systemd/system/keel-agent-network.service.d
sudo install -m 0644 scripts/keel-agent-network-cloudflare-egress.conf \
  /etc/systemd/system/keel-agent-network.service.d/30-cloudflare-tunnel-egress.conf
sudo systemctl daemon-reload
sudo /usr/local/libexec/keel-agent-cloudflare-egress start
```

The helper permits only Cloudflare's published IPv4 Tunnel destinations on
`7844`; the namespace continues to deny other egress and exposes no inbound
listener. Recheck Cloudflare's endpoint list when upgrading `cloudflared`.

Keep DNS stable inside the network namespace as well. A bind mount of a single
`systemd-resolved` file can disappear from the service's view when the host
replaces that file. The service then sees the host's loopback resolver, which
has no listener inside the isolated network. See the
[upstream systemd report](https://github.com/systemd/systemd/issues/32366). Bind
a dedicated directory containing links to the namespace's existing resolver
instead:

```sh
sudo install -d -m 0755 /etc/keel-agent-network-resolver
sudo ln -s /etc/netns/keel-agents/resolv.conf \
  /etc/keel-agent-network-resolver/resolv.conf
sudo ln -s /etc/netns/keel-agents/resolv.conf \
  /etc/keel-agent-network-resolver/stub-resolv.conf
```

For each provider service, replace the existing resolver-file bind with this
directory bind in a systemd drop-in. The example assumes DNS is the only
`BindReadOnlyPaths` entry; preserve any other entries when resetting the list.

```ini
[Service]
BindReadOnlyPaths=
BindReadOnlyPaths=/etc/keel-agent-network-resolver:/run/systemd/resolve
```

Reload systemd and restart one idle provider at a time. Verify
`/etc/resolv.conf` inside the running process's mount namespace, rather than
relying only on `systemctl show`: its nameserver must match the configured
namespace resolver. Preserve provider profiles, credentials, and existing
network rules. A synthetic systemd test should replace the host-side target file
and confirm that the service still reads its namespace resolver through the
directory bind.

Create the provider service identities once:

```sh
sudo install -d -o root -g root -m 0755 /var/lib/keel-agents
for provider in angellist tokenfolio sydecar; do
  sudo useradd --system --user-group \
    --home-dir "/var/lib/keel-agents/$provider" --create-home \
    --shell /usr/sbin/nologin "keel-$provider"
  sudo install -d -o "keel-$provider" -g "keel-$provider" -m 0700 \
    "/var/lib/keel-agents/$provider"
done
```

Existing identities must have those exact homes, primary groups, and non-login
shells. Stop instead of modifying an unexpected account.

Clone a stable Keel checkout at `/opt/keel-fi` as the deployment user and run:

```sh
cd /opt/keel-fi
make bootstrap
```

The checkout and every parent directory must be readable and traversable by the
three provider identities but writable only by the deployment user or root. Keep
provider homes, Chrome profiles, and credentials out of the checkout.

A same-user `systemd --user` service remains available for a local or temporary
bootstrap worker. It requires lingering:

```sh
sudo loginctl enable-linger keel-agent
```

Reconnect over SSH as `keel-agent` after enabling linger. A production OVH
worker uses the system services below instead and does not grant login access or
lingering to provider identities.

If an administrator has already provisioned a hardened system service with the
same origin- and provider-scoped Keel unit name, setup reuses it and does not
install a competing user service. Keep `ProtectHome=read-only` and
`ProtectSystem=strict`. Store each provider credential beneath its own home at
`.config/keel/agent-credentials/<origin-instance-id>/<provider>/authorization.json`,
with the provider directory at mode `0700` and the file at mode `0600`.

Allow the service to write only its matching profile and credential directory,
and hide both sibling homes. For example, the Sydecar service requires:

```ini
[Service]
User=keel-sydecar
Group=keel-sydecar
WorkingDirectory=/opt/keel-fi
Environment=HOME=/var/lib/keel-agents/sydecar
Environment=XDG_CONFIG_HOME=/var/lib/keel-agents/sydecar/.config
Environment=XDG_STATE_HOME=/var/lib/keel-agents/sydecar/.local/state
ReadWritePaths=/var/lib/keel-agents/sydecar/.local/state/keel/portfolio-agents/sydecar-agent/Instances/<origin-instance-id>
ReadWritePaths=/var/lib/keel-agents/sydecar/.config/keel/agent-credentials/<origin-instance-id>/sydecar
InaccessiblePaths=/var/lib/keel-agents/angellist
InaccessiblePaths=/var/lib/keel-agents/tokenfolio
```

Use the analogous identity and paths for AngelList and Tokenfolio. Do not grant
`ReadWritePaths` on a provider-home parent. Keel rejects an administrator
service unless it uses the exact provider user and group, the `/opt/keel-fi`
checkout, exactly its private app and credential directories as writable paths,
and both sibling homes as inaccessible paths.

When replacing a shared `keel-agent` identity, create all three provider homes
first, then migrate one stopped provider at a time. Move that provider's exact
origin-scoped app directory and credential directory into its new home, change
only the moved tree to its provider UID and group, update the service identity
and sandbox paths, and restart it. Confirm its saved provider session and Keel
lease before touching the next provider. Roll the move and unit back if either
check fails. Moving preserves the Chrome profile; do not copy cookies or print
credential contents.

An empty `ReadWritePaths=` or `InaccessiblePaths=` assignment in a drop-in
resets inherited entries. Add back only the canonical paths above. After all
three providers pass, verify that each provider UID can read its own
`authorization.json` and cannot traverse either sibling home. Remove empty
legacy state parents; never leave duplicate credentials or profiles behind.

## Set up one provider

From the worker checkout, run the same command shown in Holdings. For example:

```sh
make provider-agent-setup PROVIDER=tokenfolio KEEL_URL=https://keel-preview.example.com
```

On headless Linux, this command starts an X display and VNC server bound only to
`127.0.0.1`. It prints an SSH tunnel command similar to:

```sh
ssh -N -L 5901:127.0.0.1:5900 <ovh-user>@<ovh-host>
```

Run that tunnel in a second Terminal on the Mac. Then use Finder → Go → Connect
to Server and open:

```text
vnc://127.0.0.1:5901
```

Return to the worker Terminal and press Enter. In the private desktop:

1. Sign in to the selected provider, including 2FA.
2. Sign in to the target Keel origin once.
3. Return to the worker Terminal and press Enter when both pages are ready.

Setup prints a one-time VNC password, closes the interactive browser, verifies
both sessions in headless mode, stores the scoped machine credential, installs
the `systemd` service, and stops the temporary VNC desktop. The VNC port is
never exposed publicly; the password file disappears with the temporary desktop.

Repeat setup for each provider and Keel origin that the worker should maintain.
Preview and production remain isolated. A worker cannot reach a developer's
loopback Keel URL, so keep the Mac agent for local development.

The SSH and localhost VNC steps above are operator-only bootstrap and fallback
steps. They are not part of a normal provider reconnect.

## Managed provider reconnects

When a saved provider session expires, Holdings shows **Reconnect AngelList**,
**Reconnect Tokenfolio**, or **Reconnect Sydecar**. The user opens a temporary
HTTPS browser directly from Keel and completes only the provider sign-in and
2FA. There is no Terminal handoff, SSH tunnel, VNC address or password, or
second Keel sign-in.

The service creates a fresh private X display containing only the selected
provider's Chrome profile. X11, Chrome DevTools, the VNC server, and the web
stream remain bound to loopback. `cloudflared` makes an outbound temporary HTTPS
connection; no inbound VNC or web port is opened on the worker.

Each reconnect session is household- and provider-scoped, has one random entry
path, and expires after 15 minutes. Before Keel offers the link, the worker
confirms that the exact browser page is reachable through HTTPS. Keel returns
the destination once and erases it from D1 when opened; the worker removes the
entry page only after the browser viewer reaches the loopback VNC service.
Success, cancellation, failure, or timeout stops Chrome, the stream, and the
temporary HTTPS process and removes its temporary files. Provider cookies and
saved credentials remain only in the selected Chrome profile. Keel receives
browser lifecycle state, not provider passwords, cookies, or 2FA values.

After a successful reconnect, the worker safely rotates its Keel machine
credential and requests an update immediately. The old credential stays valid
until the replacement has been stored and successfully used. Any imported
changes still enter the normal review queue.

For Tokenfolio and Sydecar, an interactive portfolio alone is not success. The
worker closes Chrome gracefully, reopens the same profile through its ordinary
background launch path, and requires the same visible portfolio controls used by
capture before completing the reconnect. Tokenfolio keeps the verified browser
available for the immediate update; Sydecar closes it and reopens the same
profile for the next leased capture. A failed saved-session check does not
complete the reconnect or trigger credential rotation. Cancellation and the
15-minute lease still apply during verification.

Visible provider-owned authentication controls are classified as requiring
sign-in. Tokenfolio also recognizes explicit passkey sign-in buttons and
MFA/passkey challenges in authentication forms or blocking dialogs; optional
inline security settings are excluded. Missing, hidden, delayed, or changed
portfolio controls are reported as page-reading failures with a retry action,
not as proof of login expiry. Reconnect failures log only provider, stage and
bounded error codes; do not add cookies, page text, credentials, account
identifiers, or source URLs to logs. Deploy the API/web first and update the
existing provider service code only after its exact revision passes
verification. Preserve its Linux identity and Chrome profile. Synthetic restart
tests do not establish real-provider session durability. Sydecar's twelve-hour
refresh authorization also needs normal provider renewal before a daily capture.
After deploying migration 0060, API/web and the existing Sydecar worker, verify
a live reconnect, a later `provider_session_renewal_verified` event and the
following scheduled capture without another sign-in. Log only the bounded
request count and remaining refresh lifetime; never log token values. Check D1
lease outcomes separately from browser evidence. Preserve the existing profile,
credential, user and service sandbox throughout activation.

## Verify and operate it

Setup prints the exact unit name. Check it with:

```sh
sudo systemctl status <unit-name>
sudo journalctl --unit <unit-name> --since today
```

List all Keel portfolio-agent services with:

```sh
sudo systemctl list-units 'keel-*-agent-*.service'
```

Use the `systemctl --user` forms only on a temporary same-user bootstrap worker.

Request an immediate reviewable update with **Queue update** in Holdings. For an
operator-only CLI run, execute the provider command as its matching provider
identity with the same `HOME`, XDG directories, and executable `PATH` declared
by its system service; never run it as the deployment user.

The service checks for managed reconnect requests every 60 seconds while idle.
Tokenfolio and Sydecar also check for queued portfolio updates every minute;
AngelList keeps its daily update check. D1 determines when scheduled captures
are due. A successful reconnect checks for an update immediately. Agent and
credential activity timestamps advance at most once every five minutes during
idle polling; authorization and revocation are checked on every request.

Sydecar additionally discovers session-maintenance work hourly within that same
process. D1 admits a brief native-provider renewal six hours after verification,
with a five-minute lease, two-minute operation deadline, at most 150 page HTTP
requests and three hourly attempts before stopping. Captures and managed
reconnects exclude maintenance atomically. Setting scheduled updates off also
disables maintenance; portfolio capture times are otherwise unchanged.

An active reconnect checks status every five seconds and ends within its
15-minute lease. Failed idle checks back off from one minute to 15 minutes;
authorization failures wait 15 minutes. Successful checks restore normal timing.
Update failures back off separately, keeping reconnect discovery responsive. See
the [daily operating budget](../engineering/recurring-work-budgets.md) for the
combined request/write ceilings and latency tradeoffs.

## Recovery and updates

- If a provider session expires, use **Reconnect [provider]** in Holdings.
- If the managed browser cannot start, open **Troubleshooting** in Holdings and
  use the provider repair command there.
- If agent access is rejected, rerun setup. A successful managed reconnect
  otherwise rotates the machine credential automatically.
- After moving the checkout or changing Node or installed dependency paths,
  rerun setup so the service points at the stable executables.
- After pulling ordinary code changes into the same checkout, restart the unit
  with `sudo systemctl restart <unit-name>`.

For a polling or heartbeat change, first deploy the verified API revision. Check
that no provider capture or reconnect is active, update `/opt/keel-fi` to that
same revision, and restart each existing provider unit. Verify its executable,
working directory, revision, identity, and health. Leave profiles and
credentials in place. A Workers deployment alone does not update these
long-running clients. Observe an idle window and compare request and write rates
with the budget; report the window separately from synthetic test results.

Never copy a Mac Chrome profile to Linux. Browser secrets are platform-bound,
and a copied profile is neither a reliable nor auditable authentication path.
