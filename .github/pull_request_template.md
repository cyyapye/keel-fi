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

## Recurring work budget

<!-- Required for polling, retries, schedules, heartbeats, and their auth paths;
otherwise state N/A and why. Name the response/freshness target, every loop and
active process/deployment, 24-hour idle/failure requests and row/index writes,
shared-account headroom, independent regression ceilings, and proof the old
behavior fails. Include cancellation/revocation holdouts and how every running
client will receive the verified revision. See
docs/engineering/recurring-work-budgets.md. -->

## Deployment and recovery

<!-- State migration, rollout, rollback, backup, or explicit no-deploy impact. -->
