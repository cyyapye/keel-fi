## Summary

<!-- Explain the cohesive change and why it belongs in Keel. -->

## Architecture and security

<!-- Note data-model, calculation, auth, document, connector, or threat effects. -->

- [ ] The diff contains code, documentation, and independently fabricated data
      only.
- [ ] No real holdings, values, identities, account IDs, source documents,
      messages, tax/SPV data, credentials, or private URLs are present.
- [ ] Money calculations use integer minor units or explicit fixed precision.
- [ ] External inputs create evidence proposals and do not silently mutate
      accepted records.
- [ ] Production authentication remains fail-closed.
- [ ] Forecast and accepted review history remain immutable.

## Validation

<!-- List exact commands and outcomes. -->

- [ ] `make verify`
- [ ] Any narrower or additional checks are listed above

## Deployment and recovery

<!-- State migration, rollout, rollback, backup, or explicit no-deploy impact. -->
