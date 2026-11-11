# App access

Open **Settings → App access** in Keel. Connected apps and API keys are separate
tabs. The API-key form is immediately visible; unfinished drafts survive tab
changes. The app never shows the mock's sign-in preview controls.

## Connect a chat app

Copy the Server URL from Connected apps into the app's custom MCP connector
setup and select OAuth. Keel supports Streamable HTTP, authorization-code OAuth
with S256 PKCE, resource-bound tokens and dynamic public-client registration.
One authorization service supports compatible clients; a model switch inside an
app does not require a new grant. Client configuration and availability remain
the responsibility of the calling app.

Keel displays the registered HTTPS callback origin during consent. A registered
client cannot choose another client's callback. Names come from the callback
host, with recognizable labels for the exact ChatGPT and Claude hosts; supplied
client names cannot impersonate those apps. Review that origin before allowing
access. Read access is the default, including when a client requests goal
writes.

Choose the areas and access duration in the incoming consent screen. OAuth
access tokens last at most 15 minutes. Refresh tokens rotate on exchange; replay
of a consumed refresh token disconnects that grant. Renewal cannot extend an
owner-selected deadline. Disconnect invalidates every access and refresh token
in that grant immediately. Other grants and API keys remain independent.

## Connect a script or coding agent

Create a named key, choose its permissions, expiry and rotation policy, then
save the copy-once value in the tool's credential store. Use the API URL and
OpenAPI link displayed by this environment. Authenticate with:

```http
Authorization: Bearer YOUR_KEY
```

The UI gets its URLs from deployment bindings, not a build-time hard-coded
hostname. Preview configuration derives the browser origin and existing
`-agents` machine origin from `KEEL_PREVIEW_URL`. The release smoke requires
OAuth metadata, token endpoint and absolute OpenAPI server URL to agree with
those configured origins. Machine access bypasses browser sign-in only for the
explicit owner API, MCP and OAuth paths; provider-agent routes keep their own
credentials, and browser management endpoints remain unavailable there.

## Permissions

| Area                  | Supported access                           |
| --------------------- | ------------------------------------------ |
| Goals                 | None, read, or create/revise/archive goals |
| Holdings & valuations | None or read                               |
| Cash & debts          | None or read                               |
| Evidence              | None or read                               |

Full outlooks, unsaved previews and complete baselines require read access to
all four areas. Mark evidence requires holdings and evidence access. A caller
cannot recover an excluded area through an aggregate. Goal writes reuse the
existing validation, stable idempotency key and revision preconditions, and
record the grant ID as the actor. Accepted financial records, source acceptance
and administration are outside these grants.

## Key rotation

With **You rotate it**, create a replacement using Rotate key in Keel, save it
in the tool and discard the old value. With **Agent may rotate**, the tool may
also call `POST /api/v1/key/rotate` using its current key. The JSON response
contains `key` and `grant`; securely save the returned key before replacing the
tool's credential. Never put it in a chat transcript, logs, source or a URL.

Rotation preserves the grant's permissions and original access expiry. At most
one replacement may be pending. Both values work during an overlap of at most 24
hours, capped by the grant deadline. The previous generation cannot rotate
again. Another rotation is available after the overlap ends. Revocation
invalidates every generation; expired or revoked keys cannot renew themselves.

A lost rotation response is not automatically retried. A pending-replacement
conflict explains recovery: if the new value was not saved, revoke the grant and
create a new key in Keel. Browser failures preserve drafts, report uncertain
results and direct the owner to reload/check before another write.

## Storage and read costs

D1 stores grants and SHA-256 hashes of random 256-bit credentials; raw keys,
access tokens, refresh tokens and codes are never stored. Authorization is
checked on every request without caching or last-used writes. Created, expiry
and revocation facts are shown; no unmeasured usage status is invented.

Lists use indexed, 50-row keyset pages and replace the rendered page. Admission
is atomic at 120 active grants per household and 4,096 registered public
clients. The public registration/token and credential-creation/rotation paths
also use a 60-request/minute Cloudflare admission binding per caller IP and
location. This is an abuse guard, not an account-wide quota. Registration fails
closed when capacity is reached; the operator must investigate rather than
silently raising the limit. Consumed refresh hashes remain available for replay
detection.

This feature creates no poller, scheduled job, provider call, object read or
automatic retry. An idle or unattended failure day adds zero server-initiated
requests and writes. A client that refreshes at the 15-minute token interval
makes 96 exchanges per day; each exchange performs one indexed lookup and one
three-statement atomic batch. MCP tool calls internally reuse the API (two
current authorization reads), with no additional network hop. The owner can
revoke a grant to stop its useful-work traffic; client refresh cadence and
shared account capacity are separate from this on-demand server boundary.

The synthetic D1 tests exercise 120 grants, paged/empty results, credential
history growth, scope exclusions, expiry, PKCE, racing code exchanges, refresh
replay and revocation. The populated OLD-schema migration proof preserves the
existing household/history tables and inspects the new foreign-key indexes.
