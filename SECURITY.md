# Security policy

Keel handles highly sensitive financial metadata when privately deployed. The
public repository must never contain user data or deployment secrets.

## Supported versions

The project is pre-release. Only the latest commit on `main` receives security
updates.

## Report a vulnerability

Use GitHub's **Report a vulnerability** flow to open a private Security Advisory
for this repository. Do not include exploit details, financial information,
tokens, document URLs, or deployment identifiers in a public issue.

Include:

- affected commit and component;
- minimal synthetic reproduction;
- impact and likely attack prerequisites; and
- suggested mitigation, if known.

The maintainer will acknowledge a report as soon as practical, coordinate
validation and remediation privately, and publish a disclosure after affected
users have a reasonable upgrade window.

## Security invariants

- Production API requests require a validated Cloudflare Access JWT.
- D1 queries are scoped to the authenticated household.
- R2 source documents are private and exposed only through short-lived URLs.
- Financial records, documents, credentials, and raw request bodies are never
  logged.
- Accepted review decisions and forecast snapshots are immutable.
- External inputs are untrusted and become proposed evidence.

See the [threat model](docs/security/threat-model.md),
[data classification](docs/security/data-classification.md), and
[incident-response plan](docs/security/incident-response.md).
