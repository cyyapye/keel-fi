# Threat model

## Scope and assumptions

This model covers the private single-user alpha on Cloudflare Workers, D1, R2,
Access, and Queues-compatible ingestion. The public GitHub repository contains
source and fabricated data only. The owner's endpoint, GitHub account, and
Cloudflare account are high-value administrative boundaries.

Protected assets include financial facts, forecasts, private-company documents,
connector tokens, Access identities, backup exports, and the integrity of review
decisions.

## Threats and controls

| Threat                            | Primary controls                                                                                                                                                                                                   | Residual action                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Public-repository data leakage    | Synthetic-only policy, broad financial-file ignores, pull-request checklist, gitleaks                                                                                                                              | Treat Git history exposure as an incident; rotate and purge                                                                             |
| Compromised GitHub account        | MFA/passkey, least-privilege tokens, protected `main`, required CI, Dependabot                                                                                                                                     | Review sessions, keys, workflow changes, releases, and audit log                                                                        |
| Compromised Cloudflare account    | MFA, least privilege, separate API tokens, account alerts                                                                                                                                                          | Revoke sessions/tokens; inspect Access, Worker, D1, R2, and DNS changes                                                                 |
| Leaked Worker secrets             | Secret bindings, no plaintext config, rotation runbook, redacted logs                                                                                                                                              | Rotate the individual secret and examine deployment/audit history                                                                       |
| Malicious source documents        | Private quarantine, allowlisted types, 20 MiB limit, hash, malware scan before parsing, no active rendering                                                                                                        | Disable upload/connector and retain evidence for investigation                                                                          |
| Connector-token theft             | Dedicated secret binding, no token in D1, logs, or ordinary variables; narrow provider scopes                                                                                                                      | Revoke at provider, rotate binding, invalidate sessions                                                                                 |
| Cross-household access            | Household on every financial table; Access subject-to-household lookup; scoped repositories; tests                                                                                                                 | Add adversarial authorization tests before multi-user operation                                                                         |
| Broken Access-token validation    | Verify RS256 signature, exact issuer, audience, and subject; production fail-closed                                                                                                                                | Monitor `401` changes and test absent/invalid token behavior                                                                            |
| Document URL leakage              | Private R2, opaque object keys, maximum five-minute signed reads, `no-store`, no URL logs                                                                                                                          | Revoke signing key if applicable; rotate object key and inspect access                                                                  |
| SQL injection                     | Parameterized D1 statements; Zod validation; no user-composed SQL                                                                                                                                                  | Keep raw-query review in the security checklist                                                                                         |
| Stored XSS from imported evidence | React escaping, structured claims, strict CSP, no raw HTML rendering                                                                                                                                               | Sanitize any future rich-text renderer with an allowlist                                                                                |
| SSRF through source fetchers      | Registry-derived exact HTTPS host, Cloudflare `global_fetch_strictly_public` public-egress enforcement, DNS/IP preflight as defense-in-depth, no redirects, supported types, 1 MiB streaming limit, fetch deadline | DNS preflight does not pin the fetch destination or eliminate every rebinding risk; retain public-egress enforcement and review origins |
| Dependency compromise             | Frozen lockfile, minimal dependencies, Dependabot, review of install scripts, CI                                                                                                                                   | Pin or remove affected package; rotate secrets exposed during builds                                                                    |
| Backup exposure                   | Encrypted restricted storage, separate credentials, inventory and retention, restore tests                                                                                                                         | Revoke access, rotate encryption material, notify affected operators                                                                    |
| Accidental financial-data logging | Structured allowlist logger; no bodies, tokens, document content, query results, or raw records                                                                                                                    | Disable affected logging sink, restrict access, remove retained data                                                                    |

## Trust boundaries

1. **Browser to Access/Worker:** a browser is untrusted until Access validation
   succeeds. The API validates the assertion independently.
2. **Worker to D1:** identity maps to a household; repositories must bind that
   household into every query.
3. **Worker to R2:** object keys never enter ordinary API responses. Reads use
   short-lived authorization.
4. **External source to ingestion:** all bytes are malicious until validated,
   quarantined, and reviewed.
5. **Evidence to accepted fact:** review records a decision; a separately
   attributed workflow creates new accepted facts and a forecast version.

## Logging boundary

Allowed request-log fields are event name, generated request ID, HTTP method,
matched route template, response status, duration, and error class. Disallowed
fields include Access assertions, email addresses, raw paths containing document
keys, request/response bodies, SQL parameters, financial values, document text,
and connector payloads.

## Security test priorities

- absent, malformed, wrong-issuer, and wrong-audience Access assertions;
- a valid identity requesting another household;
- XSS payloads in every imported text field;
- SSRF private-address, redirect, wrong-type, and oversized-response cases;
- immutable-trigger behavior for snapshots and accepted records; and
- restore tests using a non-production account.
