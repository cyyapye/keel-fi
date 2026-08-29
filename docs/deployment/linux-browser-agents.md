# Linux portfolio agents on an OVH worker

Keel can run the AngelList, Tokenfolio, and Sydecar portfolio agents on an
always-on Linux worker. The worker keeps the provider sessions, stays available
for managed reconnect requests, and checks for scheduled updates once daily, so
updates do not depend on a Mac staying awake.

The agent still has the same review boundary: each successful check creates a
pending import. It cannot accept a position, remove a missing position, or
change a forecast.

## What runs on the worker

Each provider and Keel origin receives its own:

- Chrome profile under `~/.local/state/keel/portfolio-agents`;
- mode-`0600` machine credential under `~/.config/keel/agent-credentials`;
- long-running `systemd --user` service; and
- provider-scoped API access that can only manage its reconnect lifecycle,
  rotate its own credential, or queue, lease, fail, and complete an import run.

The service runs Chrome headlessly after setup. The one-time sign-in uses a
normal Chrome window in a private virtual desktop so Google and provider 2FA do
not run inside a software-controlled browser.

## Prepare the worker once

Use a dedicated, non-root Linux user such as `keel-agent`. Do not run Chrome or
the agent as root.

Install:

- Node.js 22.13 or newer and pnpm 11.9;
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

Clone a stable Keel checkout as that user and run:

```sh
make bootstrap
```

Allow the user's service manager to remain active after SSH disconnects:

```sh
sudo loginctl enable-linger keel-agent
```

Reconnect over SSH as `keel-agent` after enabling linger. The setup command
fails closed if the user service manager is unavailable.

If an administrator has already provisioned a hardened system service with the
same origin- and provider-scoped Keel unit name, setup reuses it and does not
install a competing user service. Keep `ProtectHome=read-only`, but allow the
service to atomically save credential rotation in only the matching
origin-scoped directory:

```ini
[Service]
ReadWritePaths=/home/keel-agent/.config/keel/agent-credentials/<origin-instance-id>
```

Add that setting to each provider service or a provider-service drop-in before
running setup. Keel rejects an administrator service that cannot write both its
private app directory and this credential directory.

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

## Verify and operate it

Setup prints the exact unit name. Check it with:

```sh
systemctl --user status <unit-name>
journalctl --user --unit <unit-name> --since today
```

List all Keel portfolio-agent services with:

```sh
systemctl --user list-units 'keel-*-agent-*.service'
```

Request an immediate reviewable update with the normal command:

```sh
make provider-agent-run PROVIDER=tokenfolio KEEL_URL=https://keel-preview.example.com
```

The service stays available for managed reconnect requests and reports the
worker heartbeat continuously. It checks for queued or scheduled portfolio
updates once daily even when Holdings is set to weekly or off.

## Recovery and updates

- If a provider session expires, use **Reconnect [provider]** in Holdings.
- If the managed browser cannot start, open **Troubleshooting** in Holdings and
  use the provider repair command there.
- If agent access is rejected, rerun setup. A successful managed reconnect
  otherwise rotates the machine credential automatically.
- After moving the checkout or changing Node or installed dependency paths,
  rerun setup so the service points at the stable executables.
- After pulling ordinary code changes into the same checkout, restart the unit
  with `systemctl --user restart <unit-name>`.

Never copy a Mac Chrome profile to Linux. Browser secrets are platform-bound,
and a copied profile is neither a reliable nor auditable authentication path.
