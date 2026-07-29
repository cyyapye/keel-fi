# Contributing to Keel

Thank you for helping make private-asset decision systems more trustworthy.

## Non-negotiable data rule

Contributions must contain code, documentation, and fabricated examples only. Do
not open an issue or pull request containing real:

- people, holdings, balances, valuations, cap-table details, or account IDs;
- portfolio-derived values, even if rounded or partially redacted;
- SPV, tax, legal, email, statement, or source-document contents;
- tokens, credentials, private URLs, secret references, or deployment exports.

If sensitive data enters Git history, stop work and follow
[the incident response plan](docs/security/incident-response.md). Deleting it in
a later commit is not sufficient.

## Development workflow

1. Create a focused branch.
2. Run `corepack enable` and `pnpm install --frozen-lockfile`.
3. Apply and seed local D1 with `pnpm db:reset:local`.
4. Make the smallest cohesive change.
5. Run `pnpm check` and relevant Playwright tests.
6. Explain calculation, migration, security, and data-provenance effects in the
   pull request.

## Design constraints

- Use integer minor currency units or explicit fixed-precision integers.
- Keep deterministic calculations in `packages/domain`.
- Validate inputs and external boundaries with Zod.
- Create evidence proposals instead of mutating accepted facts.
- Preserve forecast snapshots and accepted review history.
- Scope every repository query by the authenticated household.
- Never weaken production's Cloudflare Access fail-closed behavior.
- Do not introduce AI-generated calculations or an AI runtime dependency.

Schema changes require a forward migration, synthetic seed compatibility, and a
documented recovery consideration. Never edit an already-deployed migration.

## Reporting vulnerabilities

Do not file public security issues. Follow [SECURITY.md](SECURITY.md).

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
