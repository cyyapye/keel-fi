# Holdings proposal v3

Status: requires revision, not approved. User review identified incomplete fee
term entry, insufficient prominence of primary metrics and overly broad share
date requirements. Its earlier interaction/layout passes did not cover those
design failures. V3 remains a regression example, not an implementation target.
The user approved revising the model and guardrails, not this version's
application implementation. Interactive prototype state is not approval.

## Model and ordinary workflow

The user's stated ordinary workflow is one investment per legal SPV. A
multi-acquisition stress test proved useful for financial checks but was the
wrong default screen in v2. The [concept map](holdings-concept-map.md) now
distinguishes company grouping, legal position, subscription, payment history
and genuinely additional acquisitions before choosing the layout.

The initial synthetic holding has one Investment section, with its cash,
received refund, paid one-time and management fees, purchase price, shares and
carry terms. One Edit action changes investment details. There is no mandatory
purchase row to expand, no separate fee or carry editor, and no generic
remaining-shares terminology. Known facts are prefilled; unsupported facts
remain absent.

Value & return owns selecting a reported mark or share-price estimate. A
matching share class is distinguished from an explicitly selected proxy.
Calculated carry appears beside the result it affects; its contractual rate
belongs to Investment. The selected source replaces the manual form. Paid fee
components determine their total in the editor rather than requiring users to
repeat that sum.

Sources & history stays collapsed. Source-backed fee coverage explains a charge;
it never authorizes an inferred future charge. This proposal preserves the
financial definitions in the concept map and changes their presentation.

## Separate scenario contracts

| Scenario                          | Required behavior                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| One SPV investment, initial       | One Investment, one editor, no transaction list or additional-acquisition controls                   |
| Two linked SPVs                   | A sibling-position link; switching preserves each SPV's own cash, price, fees, carry, mark and edits |
| Available proxy                   | Reuse dated shares and accepted scope; one explicit Use proxy estimate, no generic checkbox          |
| Incomplete evidence               | Preserve absent fees, share count/date/scope and valuation date; no inferred net capital or value    |
| After-carry mark with payment due | No second carry deduction; retain the existing obligation's review action                            |
| No valuation source               | Reveal the reported-value form only after Add valuation                                              |
| No investment details             | Add investment details without invented dates, prices, shares or fees                                |
| Failed save and changed source    | Preserve draft and old value; retry, or review the changed source before applying                    |
| Additional acquisition, exception | Keep both accepted acquisitions and their separate charges; show Transactions only here              |

The linked scenario uses two entirely synthetic vehicles. It is a company
relationship, not proof of an allocation split. No live holdings, identifiers or
user-provided portfolio amounts are copied into fixtures. A real split requires
its own accepted relationship evidence.

## Checked calculation sheet

All operands are integer cents, ppm and share millionths. Existing v2 exception
calculations remain in the concept map; ordinary and linked cases are separate.

| Quantity                             |  Cedar I | Cedar II |
| ------------------------------------ | -------: | -------: |
| Original cash                        |  1000000 |   500000 |
| Received refund                      |   100000 |        0 |
| One-time fee paid                    |    20000 |    10000 |
| Management fee paid                  |    36000 |        0 |
| Net invested                         |   844000 |   490000 |
| Purchase price per share             |    10000 |    12500 |
| Accepted share millionths            | 84400000 | 39200000 |
| Selected price per share             |    20000 |    20000 |
| Proposed before-carry value          |  1688000 |   784000 |
| Carry rate ppm                       |   150000 |   100000 |
| Reviewed retained-cash carry basis   |   900000 |   500000 |
| Illustrative carry                   |   118200 |    28400 |
| Value after carry                    |  1569800 |   755600 |
| Cumulative simple return after carry |   66.98% |   51.12% |

Cedar I's paid management charge has explicit two-year coverage on 900000 cents
at 20000 ppm per year. That coverage belongs only to Cedar I. It is not copied
to Cedar II. The source explicitly excludes the received refund from reported
distributions, so it is included once in return proceeds. These fixtures have
accepted ownership evidence; shares are not inferred from cash or absent sales.

## Effort and implementation boundaries

- Edit an ordinary investment: Edit, Save investment (two actions); changed
  fields counted separately. Carry uses this same edit entry.
- Adopt a ready share estimate: Use estimate or Use proxy estimate (one action).
- Open the linked legal position: one sibling link. Its edits stay separate.
- Change a valuation: Change, choose method, Save valuation (three actions).
- Incomplete evidence may require additional actual decisions. A click target
  does not authorize inventing share coverage or a source's valuation date.

This is a standalone prototype with simulated saves, stale-source rejection,
obligation navigation and copy feedback. It does not prove D1 persistence,
acceptance decisions, real clipboard access or production behavior. Editing an
accepted fee amount clears a now-unreliable rate explanation in the mockup;
implementation must retain its original evidence in history. Structured
paid-management coverage and complete source-term editing remain domain/editor
integration work to settle before application implementation.

After exact-version approval, complete the required shared component states, map
this model onto canonical writers, prove accepted-state readback and evidence
invalidation, and run repository-native application checks. No application
implementation, schema migration, baseline update or deployment is part of v3.

## Verification and approval

The frozen prototype passed its interaction replay and all 30 scenario/width
checks: ten scenarios at 1024, 390 and 320 CSS pixels, with no horizontal
overflow, controls below the tested 44-pixel height, inconsistent sibling
heading sizes or browser page errors. Fifteen complete screenshots cover
desktop, mobile and a narrow dark view. Visual review found no remaining layout
defects in the ordinary, linked, incomplete, empty, due-payment, failed-save,
additional-acquisition, changed-source, no-source and dark states.

The source, replay scripts, results, complete captures, diagnostic attempts and
hash manifest are retained in task-local evidence. The frozen source SHA-256 is
`f19c9dbd5f71cb51475a01c3ea6055ddbd22c33954fc094147560eb8f1453a76`. These checks
used installed Google Chrome for the standalone mockup. They are not application
e2e, persistence, CI or deployment evidence, and do not replace an accessibility
audit.

The separate
[guidance comparison](../engineering/agent-guidance-evaluation.md#ordinary-investment-model-comparison-2026-10-06)
tied: prior guidance 3/3, revised guidance 3/3. It establishes no measured skill
improvement. The explicit ordinary-model clarification remains project
specification; no skill promotion is claimed.

Approval: unrecorded.
