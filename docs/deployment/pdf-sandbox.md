# Isolated agreement PDF reader

The existing Sydecar and Tokenfolio agents download provider-owned agreements.
Each uncached PDF is first malware-scanned, then parsed in a separate fresh,
rootless Linux container. The reader receives bytes on stdin and returns
bounded, untrusted text on stdout. It never receives provider URLs, credentials,
browser profiles, host mounts, a Docker socket, or storage access. Exact-name
extraction and the existing review boundary remain in Keel. This is containment,
not a guarantee against kernel/runtime vulnerabilities or proof that a document
is legally correct.

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

The build writes `.keel-local/pdf-sandbox.json`, its `.probe` companion, and its
`.scanner` companion (ignored, mode 0600), recording the local socket and
content-addressed image IDs. The probe image is separate and is never used by
capture. For a service whose checkout is read-only, set
`KEEL_PDF_SANDBOX_CONFIG` to a private writable path beneath that account's own
home for both the build and service environment. Do not copy credentials or
source PDFs into the checkout or image context.

Run verification under the actual service identity and confinement before
enabling agreement extraction. Do not assume a rootless daemon visible in an
administrator shell is accessible to a hardened agent service. A deployment
without working isolation may ship the API/UI but has not activated extraction.

## macOS development

Use a separate rootless Linux VM, not native Homebrew Poppler or the default
rootful Docker daemon. With Lima's rootless `docker` template:

```sh
limactl start --yes --name=keel-pdf-sandbox --mount-none --cpus=2 --memory=5 --disk=16 template://docker
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
updates over HTTPS, and enforces a Poppler package floor covering USN-8400-1.
Because the minimal Ubuntu root filesystem has no CA bundle, the build copies
only that bundle from a separately pinned Docker Official Alpine manifest;
Ubuntu's signed `ca-certificates` package replaces it during the verified
install. The final reader remains Ubuntu and contains no Alpine executables or
libraries. The build's daily cache key refreshes package installation at most
once per day per builder; capture itself never updates software. This floor is
not a complete CVE audit. Rebuild, test and activate a new image ID at least
weekly and promptly after a relevant security advisory. Patch the host kernel,
Docker, containerd and runc too; restart the rootless daemon after package
updates when its jobs are idle. Retire superseded reader/probe images and build
caches through the operator's scoped retention procedure, without deleting an
image in use by another run.

For a live update, build and verify using a candidate configuration path, not
the active service configuration. Switch the service to that candidate only
after verification passes. Keep the last verified configuration for rollback.

CI requires its own rootless daemon and no sudo. The deployment lane does not
need Docker or Poppler: parsing happens only in the existing provider agents.
Updating an agent's runtime/configuration is a separate operational step after
the API/migration has deployed. Roll back to a previously verified sandbox image
or leave extraction unavailable; never roll back to unrestricted PDF parsing.

## Malware scanner and daily refresh

The scanner uses signed Ubuntu ClamAV packages and FreshClam-verified official
signature databases. It receives only bounded stdin, has no network or host
mounts, and uses the same inspect-then-kernel-handshake gate as the reader. Its
fixed profile allows 3 GiB RAM for the signature database, no swap, one CPU, 32
processes, 16 MiB scratch, 8 MiB input, and 4 KiB result JSON. Its parent
deadline is 90 seconds and its independent watchdog is 95 seconds. These
settings do not increase the reader's 256 MiB / 30-second allowance.

The scanner limits decompressed data, recursion, files, and scan time. ClamAV
alerts for encrypted content, broken executables and exceeded limits are
blocked, not misreported as clean. A non-completed scan is unavailable. Neither
path reaches Poppler. Original bytes may still be stored in private quarantine,
with an explicit security-check problem. A clean verdict is tied to the exact
SHA-256, engine/database versions, and times. The vendor signature timestamp
must be no more than 72 hours old at scan time; the collector rechecks known
bytes under its existing weekly/24-document/64-MiB/20-minute run budgets.
Hash-identical documents share processing only within that bounded run or its
verified cache.

Scanner protocol v2 preserves at most eight validated signature tokens and
reason codes: encrypted content, a scan limit, broken executable content,
another heuristic, a threat signature, or an unknown alert. It never returns raw
scanner output, paths, provider URLs or document text. Output is captured only
on the container's bounded temporary filesystem. Oversized, contradictory or
incomplete results fail closed. These labels explain a block; they do not
diagnose the PDF as malware or authorize an exception. Historical v1 verdicts
remain readable, but their missing reasons can only be established by a fresh
check.

The owner can select **Recheck agreement** in the entity inventory. This queues
the existing provider agent with an immutable, household/provider-scoped target.
It uses the current provider session to re-download the selected agreement and
forces a fresh scan ahead of routine agreement work. It is not an R2-download
override or an independent storage scanner. Provider sign-in or page failures
still require source recovery; a busy source returns an explicit retry message.
Repeated requests for the same active target share one run. Different targets
cannot silently piggyback on it. Missing targets or incomplete scans cannot be
reported as completed rechecks. Existing lease expiry, bounded budgets and
review-before-apply continue to apply.

Deploy migration `0050` and the API/web before updating the provider agents.
Rebuild and verify the scanner v2 image under each agent's actual service
identity, then activate the matching agent code and scanner image together.
Older images are rejected for new scans rather than fabricated into v2 results.
An owner-visible queued job is not proof that a live agreement passed: verify
the fresh scan, specific reason (if still blocked), exact hash and terminal run
state after rollout. Do not raise limits or allow a flagged signature merely
because a provider supplied the file; investigate privately or obtain a new
copy.

`make pdf-sandbox-verify` additionally runs a real clean synthetic PDF and the
standard inert antivirus test string. Both must produce the expected result. The
test string never reaches a provider or R2. Production capture has no
network-enabled signature updater and cannot build an image itself.

On OVH, install `scripts/keel-document-scanner-refresh@.service` and `.timer`
for the two exact instances `sydecar` and `tokenfolio`. Do not install them for
other identities. For each, an administrator must:

1. Create `/etc/keel-document-scanner/<provider>.conf`, root-owned and mode
   0644, containing only `KEEL_PDF_SANDBOX_CONFIG` (its exact existing active
   config path) and `KEEL_PDF_SANDBOX_SOCKET` (its existing rootless socket).
2. Create its mode-0700, provider-owned directory
   `/var/lib/keel-agents/<provider>/.local/state/keel/document-scanner-maintenance`.
3. Add a root-owned instance drop-in granting `ReadWritePaths` to only the exact
   parent of the active PDF config. Mask sibling provider homes and the
   provider's Chrome-profile directory. Never grant the whole provider home or
   copy any source credential into the maintenance config.
4. Reload systemd, run the service once, inspect its exit status, and prove the
   new `.scanner` config under the actual provider service confinement. Only
   then enable the matching timer. It runs daily at a randomized time and
   catches up once after downtime. A non-blocking per-provider lock prevents
   overlapping refreshes. Record timer failure in the operator's alert channel.

The refresh builds only the scanner from the installed, reviewed checkout,
preflights a real clean synthetic PDF, and atomically replaces only the scanner
image ID. It never pulls application code, restarts the provider service,
changes accepted data, or expands network access for document processing. A
failed refresh preserves the prior configuration; its freshness guard still
fails closed after 72 hours. Check disk use weekly and retire only verified
superseded scanner images/build cache using the scoped operator procedure. No
automatic broad Docker pruning is installed.

Two simultaneous provider scans need up to 6 GiB plus the browser/host budget.
Provision at least 8 GiB available to those workloads or serialize source
updates. CI/browser tests run one worker; a developer VM needs at least 5 GiB.
These are current private-alpha bounds, not multi-tenant capacity assumptions.

References:
[ClamAV scanning](https://docs.clamav.net/manual/Usage/Scanning.html),
[signed databases](https://docs.clamav.net/manual/Signatures.html),
[scanner memory](https://docs.clamav.net/manual/Installing/Docker.html).

References:
[Docker rootless prerequisites](https://docs.docker.com/engine/security/rootless/),
[cgroup delegation](https://docs.docker.com/engine/security/rootless/tips/#limiting-resources),
[container controls](https://docs.docker.com/reference/cli/docker/container/run/),
[Ubuntu Poppler security notice](https://ubuntu.com/security/notices/USN-8400-1).
