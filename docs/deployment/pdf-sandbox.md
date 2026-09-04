# Isolated agreement PDF reader

The existing Sydecar and Tokenfolio agents download provider-owned agreements.
Only PDF parsing moves into a fresh, rootless Linux container for each uncached
PDF. The container receives bytes on stdin and returns bounded, untrusted text
on stdout. It never receives provider URLs, credentials, browser profiles, host
mounts, a Docker socket, or storage access. Exact-name extraction and the
existing review boundary remain in Keel. This is containment, not a guarantee
against kernel/runtime vulnerabilities or proof that a document is legally
correct.

## Required boundary

- A local Unix Docker socket, a rootless daemon, cgroup v2 with the systemd
  driver, and working memory, swap, CPU and process-limit controllers.
- An immutable image ID built from `scripts/pdf-sandbox/`; no runtime image
  pulls, mutable tags, remote Docker endpoints, or host-Poppler fallback.
- No network, host IPC/PID namespaces, additional capabilities or privileges;
  non-root UID/GID `65532`, no-new-privileges and the default seccomp filter.
- Read-only root, 16 MiB noexec/nosuid/nodev temporary scratch space, no core
  dumps, no persistent container logs, no host directories or image volumes.
- 256 MiB RAM, no swap, one CPU, 32 processes, 64 file descriptors, 8 MiB input,
  150 pages and 1 MiB decoded text. JSON transport is also bounded, including
  its escaping overhead. Containers are serial within each provider run; the
  existing 24-download/64-MiB/20-minute document-work budgets remain unchanged.

The launcher inspects actual container settings before starting it. The worker
then checks kernel-enforced limits, privileges, filesystem and network
interfaces before its readiness handshake. Only after that handshake does the
launcher send the PDF. A 30-second parent deadline force-removes the exact owned
container; a separate 35-second PID-1 watchdog also terminates work if the
parent disappears. Auto-removal deletes the container on exit. Failed cleanup is
not reported as a successful extraction. Missing/unsafe infrastructure returns
`extractor_unavailable`, with no unrestricted fallback. Existing holding capture
can continue, and the legal-name gap remains explicit.

## Prepare a Linux service account

Provision Docker's rootless prerequisites (`uidmap`, subordinate UID/GID ranges,
rootless extras and a user systemd session) as an administrator. Run
`dockerd-rootless-setuptool.sh check` first. Install and enable the rootless
daemon as the target unprivileged account, not as root; an administrator may
enable lingering for that exact service account. Delegate `cpu`, `memory` and
`pids` to its user manager. Do not loosen system-wide protections, add the
account to the rootful `docker` group, or share a credential-bearing daemon
between provider identities. The existing provider services and sign-ins remain
intact.

The default build socket is `/run/user/<current-uid>/docker.sock`. An alternate
local socket can be specified with `KEEL_PDF_SANDBOX_SOCKET` for the build only.
Run these as the account that owns the rootless daemon:

```sh
make pdf-sandbox-build
make pdf-sandbox-verify
```

The build writes `.keel-local/pdf-sandbox.json` and its `.probe` companion
(ignored, mode 0600), recording the local socket and content-addressed image
IDs. The probe image is separate and is never used by capture. For a service
whose checkout is read-only, set `KEEL_PDF_SANDBOX_CONFIG` to a private writable
path beneath that account's own home for both the build and service environment.
Do not copy credentials or source PDFs into the checkout or image context.

Run verification under the actual service identity and confinement before
enabling agreement extraction. Do not assume a rootless daemon visible in an
administrator shell is accessible to a hardened agent service. A deployment
without working isolation may ship the API/UI but has not activated extraction.

## macOS development

Use a separate rootless Linux VM, not native Homebrew Poppler or the default
rootful Docker daemon. With Lima's rootless `docker` template:

```sh
limactl start --yes --name=keel-pdf-sandbox --mount-none --cpus=2 --memory=2 --disk=12 template://docker
```

Use the local forwarded `sock/docker.sock` path printed by Lima as
`KEEL_PDF_SANDBOX_SOCKET` for `make pdf-sandbox-build`. No Docker context
switch, shared home folder, browser-profile mount, or new provider login is
needed. For an installed LaunchAgent, put `KEEL_PDF_SANDBOX_CONFIG` in its
environment if the configuration is outside its working directory. The VM must
be running; otherwise names remain unavailable. Stop/delete only this dedicated
VM when finished with a disposable test setup, and rebuild the configuration for
the next runtime rather than falling back to host tools.

## Verification and updates

`make pdf-sandbox-verify` is mandatory in `make verify` and the PR Quality job.
It invokes real Poppler on a synthetic PDF and a separate adversarial probe
image with the exact same launcher policy. It checks denied host reads/writes,
network and credential access, process exhaustion, memory exhaustion, output
overflow, timeout termination, and absence of retained containers. Unit tests
separately cover tampered policy, malformed output, split/invalid handshakes,
timeouts during creation, and cleanup failure. Never skip these tests or replace
the reader with a mock to make CI green. Browser capture tests also use the real
isolated reader on synthetic provider pages.

The image pins the official Ubuntu base manifest, installs signed distribution
updates, and enforces a Poppler package floor covering USN-8400-1. The build's
daily cache key refreshes package installation at most once per day per builder;
capture itself never updates software. This floor is not a complete CVE audit.
Rebuild, test and activate a new image ID at least weekly and promptly after a
relevant security advisory. Patch the host kernel, Docker, containerd and runc
too; restart the rootless daemon after package updates when its jobs are idle.
Retire superseded reader/probe images and build caches through the operator's
scoped retention procedure, without deleting an image in use by another run.

For a live update, build and verify using a candidate configuration path, not
the active service configuration. Switch the service to that candidate only
after verification passes. Keep the last verified configuration for rollback.

CI requires its own rootless daemon and no sudo. The deployment lane does not
need Docker or Poppler: parsing happens only in the existing provider agents.
Updating an agent's runtime/configuration is a separate operational step after
the API/migration has deployed. Roll back to a previously verified sandbox image
or leave extraction unavailable; never roll back to unrestricted PDF parsing.

References:
[Docker rootless prerequisites](https://docs.docker.com/engine/security/rootless/),
[cgroup delegation](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources),
[container controls](https://docs.docker.com/reference/cli/docker/container/run/),
[Ubuntu Poppler security notice](https://ubuntu.com/security/notices/USN-8400-1).
