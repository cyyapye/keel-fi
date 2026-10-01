# Reviewed investment record links

A holding's **Link investment records** action records either two sources of the
same investment or an earlier SPV fully replaced by the current SPV. The
selected current SPV keeps its identity, exposure mappings, investment amount,
purchases, and terms. The source record stops contributing to current holdings,
exposure totals, and subsequent portfolio baselines. Source snapshots,
decisions, and previous baselines remain unchanged. This does not record a sale,
refund, realization, or a second contribution.

For equivalent sources the reviewer can select the other record's reported
valuation. This preference follows later accepted snapshots from that exact
source record; a manual mark on the current SPV takes precedence. Missing,
locked, realized, historical, or cancelled source values remain unavailable;
selecting a source never converts missing value to zero or adds its amount.
Original SPV values remain in its source snapshot and in the comparison screen.
The read model carries the linked source position, snapshot, date and link
receipt separately. Cross-source valuation changes are not treated as gains
against the SPV's unrelated prior source mark.

Links form groups around one current SPV; nested groups, cycles, self-links,
cross-household links, mismatched currencies, stale snapshots and competing
valuation sources are rejected. A record with existing members cannot itself be
linked away. Unlink it before reorganizing the group. Investment participation
review heads are checked again by the database at insertion. One value source
per group is enforced by a partial unique index. Decisions are append-only;
versioned **Unlink record** decisions restore separate contributions. The source
and target must still be available for review. Changed provider identities that
cannot be matched remain subject to the normal ingestion exception process.

`0078_reviewed_position_links.sql` must precede the API/web release. Derived
current heads avoid scanning decision history. GETs perform no reconciliation,
provider reads, object reads, or writes. Position projection keeps its three
household-scoped round trips; a link review uses seven. This adds no polling,
external service, or recurring provider cost. The 120-record D1 cost test covers
positive links, repeated same-date import history, growing link history, empty
results and unrelated households, including actual row read/write counters and
query plans.

Run
`make test TEST_ARGS='packages/database/src/position-links.test.ts scripts/position-links-d1-cost.test.ts'`,
`make e2e E2E_ARGS='e2e/position-links.visual.spec.ts'`, and `make verify`.

For local practice, run `make dev SCENARIO=position-links`. The synthetic
example starts with six records across two exposures:

- Link **Demo Atlas AI source** into **Demo Atlas II SPV**, optionally selecting
  Tokenfolio's reported valuation. **Demo Atlas Separate SPV** remains separate.
- Link **Demo Orbit Aerospace source** into **Demo Orbit VII SPV** as the same
  investment, then link **Demo Orbit V SPV** as an earlier SPV replaced by VII.
- Reload, inspect source details, and use **Unlink record** to reverse a
  decision.

After all three links there are three current investments. The demo uses native
D1 records, not browser fixtures. Restarting preserves practice decisions;
`make db-reset SCENARIO=position-links` resets only this synthetic profile.
