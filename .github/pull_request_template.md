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
<!-- For review/source/UI changes, name applicable R1-R8 safeguards from
docs/engineering/review-safeguards.md. Include the reproduced failure or existing
regression, stored-value and visible-state proof, inspected desktop/mobile
artifacts, and any still-unverified live boundary. Use N/A with a reason for
unaffected layers; screenshots and local checks do not prove a live deployment. -->

- [ ] `make verify`
- [ ] Any narrower or additional checks are listed above

## Deployment and recovery

<!-- State migration, rollout, rollback, backup, or explicit no-deploy impact. -->
