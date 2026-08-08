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

## Evidence boundary

Accepted source bytes are stored under opaque keys in private R2. A classified
company event creates an immutable public observation, a factual evidence claim,
and a pending Review item. Its prior and replacement financial values are empty
objects and its forecast impact is zero. Reviewing the event records a decision;
applying it as a mark remains impossible because it contains no direct financial
claim.

## Acceptance with real public sources

Deterministic unit and security tests use fabricated content. The opt-in smoke
is acceptance for runtime real-site fetching, same-origin discovery, and event
parsing only. It starts at runtime-supplied real company homepages, follows only
same-origin discovered links, and requires the expected public event
classification:

```sh
KEEL_LIVE_COMPANY_SOURCES_JSON='[...]' pnpm test:live:sources
```

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
