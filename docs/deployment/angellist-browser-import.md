# Scheduled AngelList import

Keel uses Cloudflare Browser Run to download the investments CSV from a
dedicated read-only AngelList account. The Worker stores the private CSV in R2,
stages a pending import in D1, and stops. Holdings change only after the user
reviews the import in Keel.

The recurring run is in Cloudflare, so the Mac can be asleep. A pending import
appears on Holdings and has a durable `/holdings/imports/:id` route that can be
opened or reloaded from a phone.

## Trust boundary

- Phone setup opens Cloudflare Live View. Passwords, two-factor codes, and other
  sign-in input go directly to the short-lived remote browser, not to Keel.
- If AngelList sends a magic link, Keel accepts it only in the authenticated
  refresh request, navigates the remote browser, and immediately discards it.
  The link is never written to KV, D1, R2, logs, or status. It exists only in
  that request and the temporary remote browser, and disappears when that
  browser closes on completion, cancellation, or expiry.
- Refresh browsers run with recording disabled. Keel does not take screenshots.
  Success, cancellation, and expiry close the remote browser; the ten-minute
  Browser Run keep-alive is the cleanup fallback if a close cannot complete.
- Only secure `angellist.com` browser state is accepted. Keel and unrelated
  browser state are discarded.
- The browser state is encrypted with AES-256-GCM before it is written to KV.
  The encryption key is a Worker secret and is never stored in KV or Git.
- The existing encrypted session remains in place until the remote browser is on
  the exact AngelList origin and the exact **Export CSV** control is visible. A
  failed, expired, or cancelled refresh cannot replace it.
- The Worker checks the AngelList origin, the exact **Export CSV** control, a
  safe `.csv` filename, the one-megabyte limit, and Keel's exact 23-column CSV
  contract. A changed or expired session stops closed.
- A downloaded export creates a review item. It never confirms currency, applies
  a row, changes a holding, or changes a forecast in the background.
- Logs and automation status contain only allowlisted status codes and opaque
  import IDs. They never contain cookies, CSV cells, company names, or values.

Browser Run identifies automated requests as bot traffic. Confirm the first live
smoke succeeds before enabling the schedule.

## Protected preview rollout

Create a dedicated preview KV namespace. Add its 32-character ID and the other
automation values to the GitHub `preview` environment. The protected post-merge
workflow generates the private Wrangler configuration; do not deploy this
feature directly from a worktree.

| GitHub preview secret                       | Initial value                                                  |
| ------------------------------------------- | -------------------------------------------------------------- |
| `KEEL_PREVIEW_ANGELLIST_ACCESS_SUBJECT`     | The existing Keel Access subject that owns the household in D1 |
| `KEEL_PREVIEW_ANGELLIST_AUTOMATION_ENABLED` | `false`                                                        |
| `KEEL_PREVIEW_ANGELLIST_KV_ID`              | The dedicated preview KV namespace ID                          |
| `KEEL_PREVIEW_ANGELLIST_SESSION_KEY`        | 32 random bytes encoded as unpadded base64url                  |

The generated API configuration includes these bindings and the Monday hourly
trigger:

```jsonc
"browser": { "binding": "ANGELLIST_BROWSER" },
"kv_namespaces": [
  { "binding": "ANGELLIST_AUTOMATION", "id": "<private KV id>" },
],
"triggers": { "crons": ["0 * * * 1"] },
```

The hourly Monday trigger accounts for daylight-saving changes. The Worker runs
only when the local time in `America/Los_Angeles` is Monday at 09:00. Keeping
the initial enable flag `false` makes the trigger a no-op during rollout.

The deployment maps the GitHub values to these Worker secrets without putting
their values in a checked-in file:

- `ANGELLIST_ACCESS_SUBJECT`: the existing Keel Access subject that owns the
  household in D1.
- `ANGELLIST_SESSION_KEY`: 32 random bytes encoded as unpadded base64url.
- `ANGELLIST_AUTOMATION_ENABLED`: set to `true` only after setup, when ready for
  the first live smoke.

Merge through the normal protected Keel release flow. Its authenticated resource
smoke verifies D1, R2, Queue, KV, and the Browser Run binding without launching
a browser session. Verify the exact merged SHA is live before session setup.

## Sign in or refresh from a phone

Open Keel on the phone and choose **Holdings**. In **AngelList sign-in**:

1. Choose **Start sign-in**.
2. Choose **Open AngelList sign-in** to open Cloudflare Live View in a new phone
   tab. An unopened link expires after five minutes; Keel offers **Reopen
   sign-in** while the ten-minute refresh window is still active.
3. Sign in to the dedicated read-only AngelList account. If AngelList emails a
   magic link, copy it, return to Keel, paste it into **Magic link from email**,
   and choose **Open magic link**.
4. When AngelList shows **Export CSV**, return to Keel. Keel verifies the page,
   encrypts the filtered AngelList storage state, replaces the saved session,
   and closes the remote browser.

The window lasts up to ten minutes. **Cancel** and expiry leave the prior saved
session unchanged. A Browser Run request still identifies itself as automated,
so confirm the first live refresh against AngelList before depending on it.

The refresh lifecycle is available only to the configured Cloudflare Access
subject:

- `POST /api/automation/angellist/sign-in-refreshes` starts or reopens the one
  active refresh and returns a short-lived Live View URL.
- `GET /api/automation/angellist/sign-in-refreshes/:id` verifies completion and
  returns `waiting_for_sign_in`, `connected`, or `expired`.
- `POST /api/automation/angellist/sign-in-refreshes/:id/magic-link` navigates a
  validated HTTPS `angellist.com` link without retaining it.
- `DELETE /api/automation/angellist/sign-in-refreshes/:id` returns `cancelled`
  and closes the remote browser.

Responses use `private, no-store`. The UI keeps the Live View URL only in page
memory and remembers only the opaque refresh ID across a same-tab reload.

## Mac fallback

Run setup against the deployed Keel origin:

```sh
pnpm angellist:setup -- --keel-url https://keel-preview.example.com
```

A temporary Chrome profile opens. Sign in to the dedicated read-only AngelList
account and wait for **Export CSV** to appear. Then sign in to Keel Access in
the second tab. Keel uploads the filtered AngelList browser state directly to
the authenticated API, which encrypts it before writing KV. The temporary
profile is deleted when setup finishes.

This fallback remains useful if Live View is unavailable or AngelList blocks the
remote browser. Normal refreshes, scheduled exports, and review do not depend on
the Mac.

## Enable and run the first live smoke

After setup succeeds, change the GitHub preview secret
`KEEL_PREVIEW_ANGELLIST_AUTOMATION_ENABLED` to `true` and let the next protected
deployment publish that Worker secret. Then invoke the authenticated
`POST /api/automation/angellist/run` endpoint once from Keel's origin. This is
the only step that launches Browser Run during rollout. A successful response is
either:

- `review_ready`: a new or still-pending export is available in Holdings.
- `up_to_date`: the byte-identical export was already reviewed.

Open Keel on a phone, choose Holdings, and review the pending import. Confirm
that a reload of its `/holdings/imports/:id` URL returns to the same D1-backed
review. Only then leave the weekly trigger enabled.

`GET /api/automation/angellist/status` returns the most recent safe import
status plus `signInStatus`. `needs_sign_in` means use the phone refresh or the
Mac fallback. Other failures leave holdings unchanged and expose only an
allowlisted error code.
