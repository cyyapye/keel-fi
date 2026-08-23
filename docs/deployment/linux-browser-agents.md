# Linux portfolio agents on an OVH worker

Keel can run the AngelList, Tokenfolio, and Sydecar portfolio agents on an
always-on Linux worker. The worker keeps the provider sessions and checks Keel
once daily, so scheduled updates do not depend on a Mac staying awake.

The agent still has the same review boundary: each successful check creates a
pending import. It cannot accept a position, remove a missing position, or
change a forecast.

## What runs on the worker

Each provider and Keel origin receives its own:

- Chrome profile under `~/.local/state/keel/portfolio-agents`;
- mode-`0600` machine credential under `~/.config/keel/agent-credentials`;
- long-running `systemd --user` service; and
- provider-scoped API access that can only queue, lease, fail, or complete an
  import run.

The service runs Chrome headlessly after setup. The one-time sign-in uses a
normal Chrome window in a private virtual desktop so Google and provider 2FA do
not run inside a software-controlled browser.

## Prepare the worker once

Use a dedicated, non-root Linux user such as `keel-agent`. Do not run Chrome or
the agent as root.

Install:

- Node.js 22.13 or newer and pnpm 11.9;
- Google Chrome Stable (preferred) or a supported Chromium package; and
- `xvfb`, `x11vnc`, and `xauth` from the Linux distribution.

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

The service checks once daily even when Holdings is set to weekly or off. That
heartbeat lets Keel show whether the worker is healthy and pick up an explicitly
queued run.

## Recovery and updates

- If a provider session expires, rerun its setup command and complete sign-in in
  the temporary private desktop.
- If agent access expires, rerun setup. Issuing the replacement credential
  revokes the previous one.
- After moving the checkout or changing Node or installed dependency paths,
  rerun setup so the service points at the stable executables.
- After pulling ordinary code changes into the same checkout, restart the unit
  with `systemctl --user restart <unit-name>`.

Never copy a Mac Chrome profile to Linux. Browser secrets are platform-bound,
and a copied profile is neither a reliable nor auditable authentication path.
