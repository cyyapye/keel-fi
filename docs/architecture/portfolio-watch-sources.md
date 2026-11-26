# Portfolio Watch source allowlist

Portfolio Watch owns source discovery, grading, activation, and health. Keel
derives one watch target for every current accepted private-company exposure,
including direct and look-through holdings. Adding the first current mapping
activates the company; removing the last current mapping pauses and hides it
without deleting historical sources or observations. Public instruments and
funds remain exposure records, but they do not enter this official-company
source pipeline without a reviewed company identity and host. The watch list
follows accepted holdings. Sources are discovered after an official company
website is confirmed; an initial manual scan is optional.

When a current private-company exposure has no reviewed official host, its
target remains visible with unavailable coverage. Keel does not guess a URL;
monitoring begins automatically once a reviewed official host is available.

Company identification from imported investment evidence can record a name
without a website. Coverage now accepts a reviewed official website with the
company's exact name and the user's matching rationale. A scoped append-only
`portfolio_watch_website_decisions` record applies that identity decision and
registers a homepage for verification in the same transaction. Confirming a
website does not claim a successful fetch. Stale names, an existing host,
unrelated households and unsafe URLs fail closed; retries reuse a decision ID.
Company-name similarity alone never transfers an approved host.

An optional Brave Search connection supplies up to five website suggestions when
the user chooses Find website. Suggestions remain unconfirmed; the user checks
the company identity before confirming. Search sends only the company name,
performs one ten-second request with a 256 KiB response limit, and never fetches
candidate sites or writes company records. There is no background search or
automatic website acceptance. Without a provider key, Coverage still accepts a
known official website and does not display an inactive search button. Set the
optional `KEEL_PREVIEW_BRAVE_SEARCH_API_KEY` environment secret for the preview
deployment; it becomes the API's `BRAVE_SEARCH_API_KEY`. The key never enters
the browser or generated public configuration. Provider API:
[Brave web search](https://api-dashboard.search.brave.com/app/documentation/web-search).

## Attention and company search

Watch opens on unread news. Compact rows link directly to the article and show
published and found times. Ordinary news has no inferred financial impact or
fixed confidence percentage. Reported financing terms and any existing value
range remain available in Details. Decisions filters pending, non-superseded
financing evidence or an actual financial application; ordinary news does not
create an attention requirement merely because its evidence is pending. Review
decision opens and focuses the exact evidence item with its related reports
intact, including after reload.

Reading news uses `portfolio_watch_read_receipts`, scoped to user and household.
The authenticated read-state POST is idempotent and version checked; it cannot
accept evidence or alter financial records. A failed save leaves the item
unread. The Alpha projection joins receipts using the user/observation primary
key in its existing read, and a stale refresh cannot overwrite a newer receipt
in the browser. Unread, Decisions and All updates filter before the twenty-row
page; decisions sort first, then unread, retrieval time and ID. Activity is a
Check history disclosure within Coverage.

The shared company search filters updates before paging and sends a debounced,
bounded `q` to the coverage projection. Coverage searches the whole household
before its twenty-company cursor limit, uses a literal case-insensitive company
name match, and keeps global coverage totals separate from matching-company
counts. Changing the search resets pagination, aborts the obsolete request, and
does not display stale matches after a failed or out-of-order response. Check
now still checks the household's eligible sources; search does not alter
admission.

Coverage groups pages and feeds by publisher, with URL diagnostics behind a
disclosure that initially shows five pages. It distinguishes a missing official
host from a known website awaiting verification and a failed source read. It
shows the saved HTTP response where available to explain denied access or an
unavailable page without inferring that the company has no public news. Checks
and source verification do not change accepted financial records.

Manual and scheduled selection take one page per company before a second, up to
forty checks per run and two per company. Admission enforces the company limit
in its transaction, including direct callers. Due feeds are preferred, then
homepages and other pages; manual selection rotates by last attempt. Discovery
prioritizes feeds and newsrooms, and omits language-prefixed versions when the
same default route is present. Unique regional routes remain eligible. Existing
observations and source history are retained; publisher grouping does not assert
that different articles report identical financial facts.

## Automatic lifecycle

1. An active watch target supplies only the company's configured official host.
2. D1 creates a `discovered` homepage source bound to that exact HTTPS origin
   and makes it due for the next daily sweep. **Check now** is optional and only
   starts that same work sooner.
3. The API queues an internal source ID. URLs, hosts, household IDs, and paths
   are never accepted from a Queue message.
4. The consumer reloads the complete source policy from D1. Cloudflare's
   `global_fetch_strictly_public` compatibility flag enforces public egress;
   non-public DNS answers are separately preflighted as defense-in-depth. It
   rejects redirects and unsupported types, and limits responses to 1 MiB and
   ten seconds. DNS preflight does not pin the subsequent fetch destination;
   authority, identity, security, and operational health are graded separately.
5. A source auto-activates only when every hard gate passes. Same-origin
   newsroom, article, RSS, and Atom links become new `discovered` sources and
   repeat the same verification.
6. Failures append a verification event and move the source to `degraded` or
   `quarantined`; the audit event is never rewritten. Retrieval cursors and
   health counters live in a separate mutable sync-state table.

Third-party press rooms, cross-host feeds, JavaScript-only pages, and sites that
redirect away from the approved host are coverage gaps in this first version.
They are not silently trusted.

## IPO monitoring rollout

Holdings is the primary entry point. Watch surfaces the same exposure decision
for people who follow news. Opening an article, marking it read and choosing a
valuation source are three independent actions.

| Stage                | Source and identity                                                                                                                                                                                                                                                       | What the user sees                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public filing        | Match the reviewed issuer to an SEC CIK. Ingest its public S‑1 or F‑1 from EDGAR, including the accession number and original document URL. Keep amendments in the same offering history. A company announcement of a confidential submission can appear as company news. | An Unread headline opens the original source in a new tab. Existing position values continue to use their current sources.                                                                              |
| Listing confirmed    | Reconcile the issuer, exchange, instrument identifier, currency, security class and share-conversion or split terms against the final prospectus and exchange listing. A tentative symbol can change.                                                                     | Coverage can explain an unresolved match. A confirmed listing alone creates no valuation decision.                                                                                                      |
| First official close | Read the regular-session official close for the confirmed instrument from an entitled end-of-day source. Preserve its venue, session date, currency, unadjusted price and revision. A delayed observation can replay the first session from history.                      | One **Review valuation** action appears under the collapsed exposure and in Watch Decisions. Its review names each eligible legal position and compares current and proposed estimates before carry.    |
| User decides         | Record one version-checked exposure choice covering the reviewed eligible positions. Both entry points use the same decision.                                                                                                                                             | Choosing **Follow** clears both prompts. **Keep current sources** also resolves this proposal. The user can revisit the source from the expanded exposure.                                              |
| Subsequent sessions  | Apply new accepted official closes only to covered shares compatible with the chosen instrument and basis. Retain the last accepted close and its date over weekends, missing sessions or source outages. Preserve corrections and superseded observations.               | Both eligible estimates advance without daily approval. Holding details show the selected close and latest GP evidence separately. Incoming GP marks retain their own source, date and carry treatment. |

Before a distribution, the same review can offer an explicitly labeled price
proxy. For estimated underlying shares on a known split basis, the review can
offer one listed share's price per private share. Where conversion is unknown, a
before-carry SPV value can instead track percentage changes from the close shown
at approval. A previously accepted GP price proxy with a known current value is
eligible even if the GP omitted its mark date, provided the SPV has no recorded
distributions. The decision records the starting value and public close
separately from the GP's mark. A later backdated delivery that makes this
opening balance uncertain suspends the estimate. Later GP marks stay visible
independently. Each accepted, matched gross stock release reduces the
distributing SPV's remaining estimate. The brokerage balance comes from its own
statement.

Run `make dev SCENARIO=pre-distribution` to try both proxy methods and two stock
deliveries. Use the local app's `/local-feed` controls to advance them.

Run `make dev SCENARIO=closing-price` to try one approval across both methods.
Select **Review valuation** in Holdings or Portfolio Watch Decisions, then
**Follow CDR for 2 positions**. At the first
$50 close, Grove's 100 shares
are worth $5,000 and Summit starts at its
$2,700 GP valuation. Deliver the
next $52 close at `/local-feed`. Holdings shows
$5,200 for Grove and $2,808 for Summit. The local feed exercises the same
ingestion and valuation logic as a trusted close event.

**Implementation order for live source coverage.**

1. Extend the official-company discovery path to recognize filing links. Add
   autonomous EDGAR discovery by verified CIK and deduplicate by accession.
   First activation needs a bounded historical lookup for companies already
   trading when monitoring starts.
2. Confirm the issuer, listed instrument, share class and currency. Direct share
   pricing requires a compatible documented basis. Private units without a
   conversion ratio can track price changes from a reviewed SPV value using the
   proxy decision above. Keep the share quantity unknown in that case.
3. Use Alpha Vantage for the delayed daily-price pilot. Request the compact
   `TIME_SERIES_DAILY` history and take the raw `4. close` for a completed
   trading date. An offer price, intraday trade or price inferred from a
   brokerage balance is ineligible. Record the provider, session date and price
   as daily close evidence. The existing official-close importer accepts
   exchange closing statistics only. The pilot needs a distinct source choice so
   an existing approval to follow the official close cannot silently switch
   feeds. Show **Use daily close** once for the exposure and retain each
   position's GP mark. Verify first close, next close, correction and
   missed-session replay with synthetic positions before enabling live updates.
4. Fetch each tracked instrument once per completed session, with bounded replay
   after an outage. Route its immutable evidence to interested exposures during
   ingestion. Repeated delivery must leave one decision and one accepted
   revision for that event. A withdrawn offering stops discovery of closes. Keep
   financial reads projection-only and certify the request and D1 cost envelope
   before enabling a new scheduled producer.

Alpha Vantage's free tier allows 25 requests per day for individual,
non-commercial use. A shared deployment needs a separate agreement covering
Keel's use and display. A live pilot also needs a server-side key and a
confirmed match for the intended instrument. Keep the key out of stored source
links.

The existing weekly company-site scan supplies news and cannot guarantee
same-day filing or close coverage. Measure detection lag, unmatched instruments
and missed sessions during the pilot.

Technical references:
[SEC submissions API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces),
[Alpha Vantage daily prices](https://www.alphavantage.co/documentation/#daily),
[free-tier limits](https://www.alphavantage.co/support/),
[usage terms](https://www.alphavantage.co/terms_of_service/), and
[Nasdaq official closing statistics distributed by Databento](https://databento.com/docs/datasets/xnas-itch).

### Running the personal daily-price feed locally

The personal profile attaches a confirmed USD listing to two sample SPVs in a
separate local database. Place the public listing identity in
`.keel-local/personal-market/listing.json`. A synthetic example follows.

```json
{
  "company": "Cedar Robotics",
  "issuerId": "0000000001",
  "ticker": "CDR",
  "venue": "Nasdaq",
  "shareClass": "Class A",
  "firstSession": "2026-11-19",
  "identitySourceUrl": "https://example.test/cedar/final-prospectus"
}
```

Use the macOS Keychain generic password named `Keel personal Alpha Vantage` with
account `personal`, or supply `ALPHA_VANTAGE_API_KEY` through a local secret
manager. Start the local app with `make dev SCENARIO=personal-prices`. The app
fetches compact daily history on startup and at 10:00 UTC while running, with
one split-history request and one price-history request per daily window.
Restarting catches up within the last 100 trading sessions. The initial fetch
must include the confirmed first session. The tick and its date are the
provider's raw daily observation. Corporate actions or a change in economic
share basis require separate confirmation. This pilot assumes a fixed reviewed
allocation in both sample positions by default. For a separate local walkthrough
with private SPV estimates, run
`KEEL_PERSONAL_PROXY_DEMO=1 KEEL_PERSONAL_REPLAY_FIRST=1 make dev SCENARIO=personal-prices`.
The proxy walkthrough replays the most recently saved public price history from
the personal feed in its own synthetic database. It makes no provider requests.

For a fresh walkthrough, start with `KEEL_PERSONAL_REPLAY_FIRST=1`. Holdings and
Portfolio Watch show one exposure decision on the first observed session. After
the choice, the app imports the remaining available sessions from the same
provider response. Later refreshes follow the ordinary schedule. The walkthrough
and daily feed use the same persistent valuation and GP records. Preview runs
the personal feed on the existing Cloudflare Worker trigger at 13:00 UTC. The
protected Preview environment secret `KEEL_PREVIEW_ALPHA_VANTAGE_PERSONAL_FEED`
supplies the API key, confirmed listing, household, canonical exposure, and
reviewed share-basis key. Removing that deployment input disables the feed on
the next deployment. A matching listing can collect prices before an eligible
position follows it. Adoption requires an exposure decision covering positions
with matching share terms. Additional listings require separate identity
confirmation.

## Check cadence

The existing daily `0 13 * * *` Worker trigger also performs one bounded due
source lookup for Portfolio Watch. A successful source check becomes eligible
again after seven days, so healthy official sources are fetched weekly rather
than daily. A failed check becomes eligible again after one hour and is picked
up by the next daily sweep; unexpected Queue failures retain the Queue's bounded
retry policy. The scheduled lookup admits at most 40 opaque source-ID jobs per
run. **Check now** remains an explicit on-demand scan and does not wait for the
scheduled eligibility window.

## Saved activity and coverage

Manual and scheduled producers atomically admit a durable run and at most 40
source checks before queue dispatch. A unique active-source index prevents
racing producers from checking the same source concurrently. Each message keeps
its admitted check ID across retries. The consumer claims a two-minute lease,
allows at most four attempts, and saves a terminal outcome only after parsing
and any new observations are durably stored. Duplicate terminal deliveries do
not fetch sources, write objects, or update the database.

Signal totals include observations committed before an interrupted completion. A
changed feed can contribute up to forty new observations on each of the four
allowed attempts, so a check can retain 160 signals and a forty-check run can
retain 6,400. These receipt bounds do not add fetches, attempts, or writes.

Runs have a fifteen-minute deadline. The read projection displays an unfinished
run and its sources as timed out without writing state. A later explicit or
scheduled admission expires the old check before admitting replacement work; a
stale completion cannot replace the newer outcome. Queue dispatch errors may
leave an admitted check pending because delivery is uncertain. The UI exposes
that pending state and the deadline instead of claiming success or silently
retrying dispatch. Pre-migration queue messages remain compatible; historical
activity is not invented for checks that were never recorded.

`GET /api/watch/activity` reads only D1 projections under the current Access
identity. It returns twenty companies per cursor page, at most fifty source
records per company, and twenty recent runs with at most forty checks each. The
read takes five database round trips independent of page size. Completion and
successful completion have separate timestamps from an attempted fetch. Signals
retain both the publisher's timestamp and Keel's retrieval timestamp.

`GET /api/watch/activity/progress?runId=…` returns the selected run's forty
sources and twenty recent runs in three database round trips. It drives active
progress updates without repeatedly scanning full household coverage. A terminal
response refreshes coverage once so newly discovered sources also appear.

Coverage shows the approved URL, source kind, last successful check, last
attempt, next scheduled attempt, and any unavailable or unfinished result. The
screen distinguishes a completed check with no new signals from no source, no
completed check, failure, or timeout. Activity survives reloads. Visible active
runs refresh progress every ten seconds until completion or the server deadline;
idle pages and hidden tabs do not continuously poll. The full request and
storage envelope is documented in
[recurring work budgets](../engineering/recurring-work-budgets.md#portfolio-watch-progress).

## Evidence boundary

Accepted source bytes are stored under opaque keys in private R2. A classified
company event creates an immutable public observation, a factual evidence claim,
and a pending Review item. A financing announcement may also contribute bounded,
typed company-level terms: round, instrument, announced amount, currency,
reported company valuation and valuation basis, exact supporting wording, and
ambiguity flags. These are reported facts, not a Keel valuation of the holding.
Money remains integer minor units. A bare `$` is not assumed to mean USD; Keel
leaves the amount unselected and flags that the currency is not explicit. Review
shows at most one 25-word/240-character source excerpt and a credential-free
HTTPS link to the approved official origin.

The event's prior and replacement financial values remain empty objects and its
forecast impact remains zero. Reviewing the event records a decision; applying
it as a mark remains impossible because `company_event.financing_terms` is not a
direct financial-record claim. Position value still requires separate ownership,
security terms, dilution, and an explicit user-reviewed valuation decision. A
review decision also locks every claim on that event against later insertion,
editing, or deletion. Semantic changes to reported terms receive a new
append-only fingerprint and Review item; identical terms deduplicate.

## Signal reconciliation and proposed updates

Keel derives reconciliation groups from immutable financing observations. The
group key is the company plus a normalized round label. Within a group, an older
observation from the same canonical URL is superseded, compatible current terms
corroborate one another, and differing explicit amounts, currencies,
instruments, round types, or valuation bases conflict. Input order does not
affect the result. The recommended queue puts unresolved conflicts first, then
corroborated reports, then unconfirmed reports; groups with no pending review
follow groups that still need a decision.

A proposed update is available only after every current, non-rejected report is
reviewed, the current reports have no blocking ambiguity or conflict, and they
support one explicit company valuation. The proposal stores the exact
reconciliation SHA-256, its reviewed evidence events, and the exact latest
scenario snapshot and version. It is append-only and separate from accepted
marks and forecast snapshots. A later observation or scenario snapshot makes the
earlier proposal out of date; it is never silently rebased or applied. Reported
company valuation remains context only until a later review has the ownership,
security, and dilution terms needed to calculate a holding or scenario value.

## Acceptance with real public sources

Deterministic unit and security tests use fabricated content. The opt-in smoke
is acceptance for runtime real-site fetching, same-origin discovery, and event
parsing only. It starts at runtime-supplied real company homepages, follows only
same-origin discovered links, and requires the expected public event
classification:

```sh
KEEL_LIVE_COMPANY_SOURCES_JSON='[...]' pnpm test:live:sources
```

For a financing page, runtime input may also include strict
`expectedFinancingFacts` assertions for round, instrument, amount/currency,
valuation/basis, qualifiers, and ambiguity flags. The acceptance result reports
only whether those facts matched and aggregate counts; it does not print the
company, URL, excerpt, or expected money values. Real acceptance should use a
page that states its currency explicitly (`USD` or `US$` for US dollars).

The JSON input and fetched bytes are runtime-only. They must not be added to the
seed, fixtures, screenshots, logs, or Git. The synthetic household and holding
shell remains fabricated; the observed companies and sources in this smoke are
real so selection and parsing encounter actual web behavior.

This smoke does not exercise the production D1 registry lifecycle, Queue
consumer, private R2 write, or pending Review record. Before release, run a
runtime-only full-path preview smoke against an Access-protected preview
deployment: create a synthetic household and watch target with a
runtime-supplied real company host, trigger one scan, then verify the
discovered/active source lifecycle, Queue delivery, private R2 object, and
pending Review proposal. Do not retain the real company input or fetched
document in seeds, test fixtures, logs, or Git.

## Reversible local lifecycle acceptance

For a full local D1 and Queue exercise, pass an up-to-three-company real-source
overlay through `KEEL_LOCAL_ACCEPTANCE_PROFILE_JSON` (or standard input with
`KEEL_LOCAL_ACCEPTANCE_PROFILE_STDIN=1`). It accepts one to three assignments to
the fixed synthetic company IDs, using public company identity and official
homepage URL only—never a holding, account, quantity, value, credential, or
source document. The required shape is:

```json
{
  "version": 1,
  "companies": [
    {
      "companyId": "co_northstar",
      "legalName": "Public Company One",
      "homepageUrl": "https://news-one.example/"
    },
    {
      "companyId": "co_harbor",
      "legalName": "Public Company Two",
      "homepageUrl": "https://news-two.example/"
    },
    {
      "companyId": "co_lattice",
      "legalName": "Public Company Three",
      "homepageUrl": "https://news-three.example/"
    }
  ]
}
```

Save that JSON outside the repository, then run:

```sh
KEEL_LOCAL_ACCEPTANCE_PROFILE_STDIN=1 make local-acceptance-apply \
  < /private/path/real-company-profile.json
# exercise one local scan and verify its pending Review evidence
make local-acceptance-dev
# in another terminal, compare hash-only output before and after the scan
pnpm local:acceptance:invariants
make local-acceptance-restore
```

Apply creates a fresh, ignored `.keel-local/acceptance` persistence root,
migrates and seeds it from the canonical fictional seed, then changes only the
assigned synthetic companies' legal names and official hosts inside that
disposable state. The normal local D1/R2/Queue state is never opened or changed.
The acceptance UI labels the distinction as
`Real public sources · Demo portfolio figures`. Restore removes only that exact
disposable persistence root, including its source registry, observations,
evidence, source-document metadata, and local R2 bytes. It does not delete
accepted financial records or weaken any append-only trigger because it does not
edit the canonical local state.

The invariant command reads only the disposable local D1/R2 profile and emits
table hashes plus aggregate evidence/object counts. It never prints company
identity, URLs, excerpts, money values, or rows. Financial table hashes must be
identical before and after a source scan; only source/evidence counts may grow.
