# Data classification and handling

## Classes

| Class        | Examples                                                                                                                                                               | Repository          | Storage and handling                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------------------------- |
| Public       | Source code, architecture docs, fabricated companies and values                                                                                                        | Allowed             | Normal public Git workflow                                                   |
| Internal     | Unreleased roadmap, non-sensitive operational notes                                                                                                                    | Avoid unless needed | Access-controlled collaboration tools                                        |
| Confidential | Holdings, cash/debt balances, normalized transaction mutations, aggregate burn, payments, due dates, forecasts, identities, account IDs, tax profile, company evidence | Forbidden           | D1 or encrypted export with least privilege                                  |
| Restricted   | Raw transaction pages and descriptions, source documents, emails, tax/SPV documents, Access assertions, connector tokens, signing material, backups                    | Forbidden           | Bounded memory, secret binding, or private R2; shortest retention and access |

Synthetic data is Public only when it was created independently for
demonstration and is not a transformed, rounded, shifted, or anonymized copy of
a real portfolio.

## Data flow rules

- D1 is canonical for normalized Confidential facts.
- R2 stores Restricted source-document bytes. The bucket has no public access.
- Connector credentials live only in dedicated secret bindings or an approved
  secret manager. D1 stores a non-secret reference, never a token.
- Raw provider account and user identifiers are Confidential. Encrypted
  connector state may retain the minimum account identifier needed to operate;
  D1 and Queue messages use only keyed or internal opaque identifiers.
- Browser responses contain only the minimum household view required for the
  current decision surface.
- Logs use an explicit metadata allowlist and must not contain Confidential or
  Restricted fields.
- Raw transaction pages may exist only in bounded Worker memory during
  validation and normalization. They are never stored in R2, D1, browser state,
  logs, test artifacts, or backups. D1 may retain only HMAC transaction/account
  keys, mutation kind, date/month, signed integer minor units, pending state,
  supported-currency state, and primary category.
- Merchant/name text, counterparties, locations, logos, websites, payment
  channels, request IDs, and raw provider identifiers are discarded before D1
  writes. Aggregate category and month totals remain Confidential.
- Exports and backups are Restricted even when encrypted.

## Upload policy

Before an upload route is enabled it must:

1. authenticate and authorize the household;
2. enforce an allowlisted MIME type and extension;
3. reject files larger than 20 MiB before buffering;
4. generate a cryptographic content hash;
5. write to a private quarantine prefix;
6. malware-scan and parse in an isolated process with time and memory limits;
7. strip active content and never render imported HTML directly; and
8. create proposed evidence requiring review.

The bootstrap intentionally exposes no upload route.

## Retention and deletion

Accepted financial facts, review decisions, and forecast versions are audit
records and are not hard-deleted by application code. Future privacy deletion
requirements must use a documented tombstone/redaction workflow that preserves
audit integrity without retaining unnecessary identifying content.

Source-document and backup retention must be configured per deployment, tested,
and recorded. Deleting an R2 object does not authorize deleting its evidence
metadata or accepted decision history.

Redacted transaction mutation revisions use a 24-month rolling retention window
and are deleted on successful sync after that boundary. Disconnect deletes all
remaining normalized transaction revisions, the operational cursor, and the
encrypted provider credential after provider removal succeeds. Cash-flow
activation events, reviewed aggregate proposals, decisions, accepted plans, and
forecast versions remain audit records because they no longer contain raw
transaction text or provider identifiers.
