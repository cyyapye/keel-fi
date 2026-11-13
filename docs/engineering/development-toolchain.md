# Development toolchain

Keep the Node and pnpm versions declared by the repository toolchain. Upgrade
build, test and deployment dependencies without changing Workers compatibility
dates, verification deadlines or registered behavior coverage.

Wrangler and direct Miniflare use the same vendor runtime version. The direct
test helpers use Miniflare's official v4-options adapter. Their
`resourcePersistencePath` names the resource root; sealed D1 copies remain in
its `d1` child. A changed lockfile invalidates old fixture seeds.

The patched D1 runtime selected the household application index for two
position-scoped lookups. Cash history explicitly selects the existing position
index. Migration `0096_economics_snapshot_lookup.sql` makes the same selection
inside the economics stale-snapshot guard. Its provenance, freshness and chain
predicates remain unchanged. The populated migration proof preserves the OLD
schema's records and all other objects before certifying the replacement;
steady-state cost tests retain their existing limits. No index is added.

Two dependency exceptions need review when updating tools:

- `@cloudflare/workers-types` stays pinned to the existing `5.20260728.1`
  declarations. Newer declarations introduce untyped global `Buffer` and
  `process` values that obscure Node types in mixed test/compiler contexts.
  Wrangler's optional typings peer warning is intentional. This pin does not
  select the deployed Workers runtime. Remove it after proving precise Node and
  Workers types coexist without suppressing typed lint.
- Three lint consumers temporarily select minimatch 11 through scoped overrides.
  Their declared minimatch 10 line has no advisory fix. These consumers use the
  retained matching APIs. Before changing the overrides, compare ESLint's exact
  source-file inventory, configured ignore decisions and partial directory
  matching. Remove the overrides when those parents declare a patched dependency
  directly. Do not replace them with a global override.

The release-age exclusions name only the reviewed Wrangler and bundled Miniflare
versions. They do not exempt future releases or other packages from the package
manager's supply-chain policy.

Run both `pnpm audit --prod` and `pnpm audit` when changing dependencies. A
clean audit covers known version advisories; runtime, migration, native
accounting and browser verification remain separate requirements.
