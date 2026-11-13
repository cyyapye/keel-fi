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
2. Run `make bootstrap` in a fresh clone or worktree.
3. Start both local services with `make dev` and use the printed URLs.
4. Make the smallest cohesive change.
5. Run `make verify`, or focused Make targets while iterating.
6. Explain calculation, migration, security, and data-provenance effects in the
   pull request.

Bootstrap reuses the host's registered PDF runtime. On a host with an existing
configured checkout, run `make pdf-sandbox-register` there once. For a new host,
follow the
[PDF runtime setup](docs/deployment/pdf-sandbox.md#development-worktree-bootstrap).
Bootstrap reports missing or inaccessible infrastructure before seeding D1.

Review the [development toolchain](docs/engineering/development-toolchain.md)
before changing dependency pins or overrides.

The isolated [Tugling candidate pilot](docs/engineering/tugling-pilot.md) adds
`make pilot-verify` for complete native case accounting on a committed revision.
Its separate source pin and PR-head evidence do not promote the candidate or
replace the accepted release/deployment checks.

Repository rules for `main` should require the four PR Checks jobs documented in
`.github/workflows/README.md`. The post-merge workflow verifies the exact merged
commit before automatically deploying it to the protected preview environment.

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
