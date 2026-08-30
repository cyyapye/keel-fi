# Portfolio Watch source allowlist

Portfolio Watch owns source discovery, grading, activation, and health. The user
chooses holdings and asks Keel to check for updates; the UI does not ask the
user to curate URLs or feeds.

## Automatic lifecycle

1. An active watch target supplies only the company's configured official host.
2. D1 creates a `discovered` homepage source bound to that exact HTTPS origin.
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

## Check cadence

The existing daily `0 13 * * *` Worker trigger also performs one bounded due
source lookup for Portfolio Watch. A successful source check becomes eligible
again after seven days, so healthy official sources are fetched weekly rather
than daily. A failed check becomes eligible again after one hour and is picked
up by the next daily sweep; unexpected Queue failures retain the Queue's bounded
retry policy. The scheduled lookup queues at most 100 opaque source-ID jobs per
run. **Check now** remains an explicit on-demand scan and does not wait for the
scheduled eligibility window.

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
