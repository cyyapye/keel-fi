# Private worker administration and authenticated reconnects

Private worker administration uses Tailscale for network reachability and the
existing key-only OpenSSH server for login. Customer reconnects use named
Cloudflare Tunnels protected by Access. Customers do not join the operator's
tailnet. These are separate boundaries and neither replaces provider MFA.

## Access sessions

Set the Cloudflare organization global session duration to **seven days**. Keep
the Keel application token at **one hour**, and each provider reconnect
application token at **15 minutes**. A still-valid global session lets Access
renew application tokens without another IdP login, subject to policy checks.
This behavior is documented in
[Cloudflare session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/).
Cleared cookies, a revoked session, changed policy, or an IdP requirement can
still prompt for authentication. Provider sign-in and provider MFA retain their
own expiration rules.

Use MFA at the identity provider. Sensitive operator administration requires
fresh authentication through the operator's identity provider; a long customer
SSO session is not a fresh-auth check. Cloudflare session configuration alone
does not implement Keel-wide step-up authentication for customer account
changes.

## Reconnect provisioning

Provision before upgrading the API and all three provider workers. There is no
Quick Tunnel fallback: absent or invalid configuration fails closed. Normal
automatic captures and session maintenance retain their existing scheduling.

For each of `angellist`, `tokenfolio`, and `sydecar`:

1. Derive the hostname with `providerBrowserOrigin(apiOrigin, provider)` from
   `packages/domain/src/index.ts`. For the synthetic API origin
   `https://keel-preview-agents.example.com`, the Tokenfolio origin is
   `https://keel-preview-tokenfolio-reconnect.example.com`. Use one subdomain
   level so an ordinary certificate covers it.
2. Create a separate remotely managed named Tunnel and DNS route. Route only
   that provider hostname to its loopback gateway port inside `keel-agents`; use
   a final `http_status:404` ingress rule. Suggested ports are 16001, 16002,
   and 16003. Do not install an always-on tunnel service: the worker owns the
   tunnel process only during a reconnect lease.
3. Create a self-hosted Access application for the exact hostname, with the same
   team/identity provider as Keel and the existing authorized user policy.
   Require MFA and set the application duration to 15 minutes. Do not use a
   Bypass policy or wildcard application. Record its application audience.
4. Create a separate readiness service token for this provider. Add a Service
   Auth policy for that token. Origin validation permits it only on the current
   lease's readiness path; it cannot read HTML/assets or open a viewer. Set an
   expiry, monitor it, and rotate before expiry. Never grant that token user API
   or worker administration access.
5. Enable Tunnel origin Access JWT validation for this team and audience, in
   addition to the gateway's own verification. Preserve the original public Host
   header. Use `cloudflared` 2025.4.0 or later for
   [the token-file option](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/run-parameters/).
6. Store the tunnel token, readiness credentials, and configuration under the
   corresponding provider's private credential directory. Each file must be
   owned by that provider UID, be a regular file, and have mode 0400 or 0600.
   Keep the parent directory at 0700. Set `KEEL_RECONNECT_CONFIG_FILE` in that
   provider's systemd override to the configuration's absolute path. Keep values
   and deployment identifiers out of Git and shell history. No credential
   belongs in command arguments or logs.

Prefer systemd `LoadCredentialEncrypted` for the tunnel and readiness secrets,
using the host TPM when available. Keep encrypted inputs in the provider's
private credential directory. Copy decrypted credentials into a provider-owned
`RuntimeDirectory` with mode 0700 and files at 0400; the gateway requires those
permissions and must not assume systemd's credential directory has the same
mode. Use `ExecStartPre` to copy from `%d`, and let systemd remove the runtime
directory when the service stops. For example:

```ini
[Service]
RuntimeDirectory=keel-reconnect-tokenfolio
RuntimeDirectoryMode=0700
LoadCredentialEncrypted=reconnect-tunnel-token:/var/lib/keel-agents/tokenfolio/.config/keel/reconnect/tunnel-token.cred
LoadCredentialEncrypted=reconnect-probe:/var/lib/keel-agents/tokenfolio/.config/keel/reconnect/probe.cred
ExecStartPre=/usr/bin/install -m0400 %d/reconnect-tunnel-token /run/keel-reconnect-tokenfolio/tunnel-token
ExecStartPre=/usr/bin/install -m0400 %d/reconnect-probe /run/keel-reconnect-tokenfolio/probe.json
Environment=KEEL_RECONNECT_CONFIG_FILE=/var/lib/keel-agents/tokenfolio/.config/keel/reconnect/access.json
```

Before activation, verify decryption and permissions with an isolated unit using
the same provider UID and sandbox, then verify the temporary runtime directory
is removed. A host-key fallback does not provide TPM protection. Keep encrypted
credential inputs and the host key outside Git and backups of public source.
File permissions alone are access controls, not encryption at rest. Browser
profiles also contain provider credentials and need encrypted host storage and
protected backups in a public hosted deployment.

Synthetic configuration shape (replace privately; never commit the populated
configuration):

```json
{
  "version": 1,
  "apiOrigin": "https://keel-preview-agents.example.com",
  "provider": "tokenfolio",
  "publicOrigin": "https://keel-preview-tokenfolio-reconnect.example.com",
  "teamDomain": "synthetic.cloudflareaccess.com",
  "audience": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "listenPort": 16002,
  "tunnelTokenFile": "/run/keel-reconnect-tokenfolio/tunnel-token",
  "probeCredentialsFile": "/run/keel-reconnect-tokenfolio/probe.json"
}
```

The readiness file contains `clientId` (32 lowercase hex characters followed by
`.access`) and `clientSecret`. The tunnel file contains only its named-tunnel
token. Use separate tokens, audiences, files and UIDs for each provider.

The gateway validates signature, issuer, audience, token type, issued-at and
expiry on both HTTP and WebSocket upgrade. D1 supplies the requesting user's
Access subject; email matching is insufficient. HTTP and WebSocket paths are
bound to the current lease nonce. At most one viewer is admitted; disconnect
does not release admission. A new reconnect is required after a disconnect. The
socket closes at JWT or lease expiry, whichever comes first. Keel cancellation
is detected by the existing five-second status polling; blocked provider
verification can delay that observation. Gateway expiry closes the stream
independently of that polling. Access revocation alone does not instantly close
an established WebSocket; the 15-minute lease bounds it. Cloudflare terminates
HTTPS and is a trusted intermediary for the reconnect stream.

Opening the Keel link uses a passive GET interstitial followed by a same-origin
authenticated POST with a required custom header. Only POST consumes the link.
The API accepts destinations only on the independently derived provider origin.

## Tailscale enrollment and private SSH

Use an organization-owned tailnet with MFA and device approval. Enroll the
operator Mac and the worker, approve both devices, and remove the default
allow-all policy. Use a dedicated operator group and worker tag. The following
synthetic policy grants only SSH; replace the operator identity privately:

```json
{
  "groups": { "group:keel-operators": ["operator@example.com"] },
  "tagOwners": { "tag:keel-worker": ["group:keel-operators"] },
  "grants": [
    {
      "src": ["group:keel-operators"],
      "dst": ["tag:keel-worker"],
      "ip": ["tcp:22"]
    }
  ],
  "tests": [
    {
      "src": "operator@example.com",
      "accept": ["tag:keel-worker:22"],
      "deny": ["tag:keel-worker:443", "tag:keel-worker:5900"]
    }
  ]
}
```

Use approved operator devices only; add policy tests denying non-operators when
there are other users. See
[Tailscale grants](https://tailscale.com/docs/reference/examples/grants). Do not
advertise subnet routes or an exit node. Keep Tailscale SSH disabled: OpenSSH
continues to enforce the existing key, user, and root-login rules. For this
host, use `--accept-dns=false`, `--accept-routes=false`, `--ssh=false`,
`--netfilter-mode=off`, and the worker tag during enrollment. Explicitly allow
TCP22 on `tailscale0` in UFW. This preserves UFW's control rather than relying
on Tailscale's automatic interface ACCEPT rules. Existing provider network
namespace isolation and its default-deny inbound policy remain mandatory. UDP
ingress is optional for direct-path performance; SSH can initially use outbound
relay connectivity without opening another public port.

Keep the public SSH rule during enrollment. Before removing it:

1. Prove OVH console/recovery access and record the firewall restoration command
   in the private operator runbook. Keep an authenticated public SSH session
   open and arrange a timed rollback of only the SSH rule.
2. Add a separate local SSH alias using the worker's tailnet IP/MagicDNS name,
   the existing SSH user and key, and the existing verified host key. Do not
   disable host-key checking or replace the public alias until tested.
3. From a new Mac connection, prove private SSH and required sudo operations.
   Verify a non-operator cannot reach SSH and VNC/web ports remain inaccessible.
4. Remove the UFW public TCP22 rule for **both IPv4 and IPv6**. Prove a fresh
   private connection still works and a fresh connection to the public address
   fails. Check listeners and firewall state; an existing SSH session is not
   proof of a new connection. Then cancel the timed rollback.
5. Verify all provider units, profiles, permissions, namespace isolation and
   outbound captures after the change. Store sanitized proof privately.

Do not close public SSH based on an installed daemon, a tailnet status page, or
the absence of an active capture. Those do not establish recovery or
reachability.

## Release and public distribution boundaries

Read authenticated D1 operation state and the worker process state immediately
before any shared checkout change. Stop all three idle provider units, preserve
their profile and credential identities, update to the exact verified revision,
install the frozen dependencies, and restart all three. Follow the
[release evidence contract](../../.github/workflows/README.md).

Before rollout, prove through the real edge that an unauthenticated request,
another user's assertion, a service token on a viewer path, a second viewer, and
an expired/cancelled lease are rejected. Prove normal HTML/assets/stream work
for the requesting user on desktop and mobile. A named Tunnel or an Access
dashboard setting by itself is not proof. Stage all three provider scopes before
the API begins rejecting legacy destinations. Rollback must not restore a public
bearer-only reconnect; disable managed reconnect until authenticated access is
repaired if the secure revision cannot be retained.

This is the private-alpha operator/reconnect boundary. A hosted public launch
also requires tenant-specific browser/storage isolation, customer identity and
recovery, enforceable step-up for sensitive customer actions, credential
rotation/auditing, abuse admission budgets across customers, backup/recovery
proof, and independent security review. Self-hosting must keep the same
fail-closed configuration and isolation defaults. Neither distribution should
make stronger security contingent on a Keel paid tier. Before accepting
untrusted public pull requests, remove persistent privileged self-hosted CI
runners from that execution path; use hosted or isolated ephemeral runners.
