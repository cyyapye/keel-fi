# Legal-entity Google Sheets export

The **Export** button at the top of Legal entities opens the record and column
choices. CSV is always available. When Google is configured, **Create Google
Sheet** asks the user to choose a Google account and authorize a new sheet.
Cloudflare Access sign-in, including sign-in through Google, does not grant
Google Sheets access.

## Enable the destination

1. In a Google Cloud project, enable the Google Sheets API and configure the
   OAuth consent screen for Keel. If the project is in testing, add the intended
   Google accounts as test users.
2. Create an OAuth client with application type **Web application**. Register
   each exact Keel origin under **Authorized JavaScript origins**, including the
   isolated localhost origin printed by `make dev` when testing locally. This
   popup flow does not use a redirect callback route.
3. Configure `GOOGLE_SHEETS_CLIENT_ID` on the API Worker. This is the public
   OAuth client ID ending in `.apps.googleusercontent.com`, not a client secret.
   For local development, add that single value to the ignored
   `apps/api/.dev.vars`; do not copy credentials between worktrees. For a
   deployed environment, add a secret binding with that name to the actual API
   Worker in the Cloudflare dashboard. For preview, use the Worker identified by
   `KEEL_PREVIEW_API_WORKER` in the GitHub `preview` environment. The checked-in
   Wrangler configuration does not define a preview environment; the deployment
   workflow generates private configuration with the correct Worker name. Secret
   bindings persist across normal deployments.

4. Reload Legal entities, open **Export**, and create a sheet using synthetic
   records. Verify the chosen columns, complete record count, literal values,
   and **Open Google Sheet** link. Also cancel the Google dialog and confirm the
   choices and CSV download remain usable.

An absent or invalid client ID keeps the Google action hidden. A configuration
or Google script retrieval failure shows a retry alongside the CSV fallback. No
Google script or authorization request is made until Export is expanded. The
setup instructions above require the deployment owner's Google Cloud
configuration; browser mocks do not prove a live account can authorize it.

## Data and recovery contract

- The authenticated export endpoint reads the same D1 projections and applies
  the same fields and filters for CSV and Google Sheets. It exports the complete
  selection, independently of how many rows have rendered in the browser.
- Google authorization requests only `drive.file`, which covers files created or
  explicitly opened with the app. It does not request Gmail access or
  unrestricted Drive/Sheets access. The account chooser is invoked directly from
  the user's create click.
- The short-lived Google token exists only during that browser operation. It is
  not sent to Keel's API, persisted in browser storage, or saved on the server.
  Reloading starts a new authorization operation.
- One Sheets create request contains the entire inventory, a frozen header, and
  a filter. Every cell uses `stringValue`; formula-like evidence, leading zeros,
  exact currency text, unknown values, and legal-position distinctions are
  preserved. Keel does not change sharing permissions or accepted records.
- Direct creation is bounded to 10,000 data rows, 50,000 characters per cell,
  and a 2 MB request body. Larger exports use CSV. There is no per-row network
  request, polling, scheduled sync, or automatic retry.
- A network failure, timeout, server error, or unreadable success response can
  leave a created sheet whose link is unknown. The UI directs the user to check
  Google Drive before retrying. A confirmed success provides the sheet link and
  disables creation with unchanged choices and inventory date.

References: Google's
[token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[OAuth setup](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid),
[Sheets creation endpoint](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/create),
and
[spreadsheet resource](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets).
