# Holdings proposal v2

Status: superseded by [proposal v3](holdings-ux-proposal-v3.md), not approved.
V2's default exposed a multi-acquisition exception as the ordinary SPV model.
The historical checks below remain evidence for this version only. The
interactive proposal is attached to the task conversation; it uses synthetic
data and simulates local saves. No application change is authorized by this
document or by an interaction in the proposal.

## Decision and ownership

The [concept map](holdings-concept-map.md#metric-definitions-for-proposal-v2)
defines meanings, calculation bases and expected integer results before layout.
The proposal keeps the previously selected summary-first direction and tests one
revised information architecture, rather than reopening unrelated visual
directions.

| User question                                     | Presentation                                                                                                   | Canonical writer                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| What did I put in, receive back and pay in costs? | Purchases & refunds, with paid setup and prepaid management under the applicable purchase                      | Existing Investment details editor focused on that purchase                                   |
| What is it worth, and how does carry change it?   | Headline holds the saved mark; Value & return holds source/method, carry terms and the carry-only illustration | Valuation selection for the mark; the same Investment details writer for reviewed carry terms |
| Is a payment actually due?                        | A dated unpaid fee with Review payment beside the cash history                                                 | Existing Obligations workflow; no second payment or fee editor                                |
| Who owns it and where did the facts come from?    | Owner and vehicle in the heading; supporting Sources & history disclosure without repeating identity           | Existing ownership and evidence workflows                                                     |

There is no standalone Fees & carry section. Paid fees explain purchase capital;
contingent carry explains value. A supported unpaid obligation still has a
visible action. Database ownership does not determine the grouping.

Purchase disclosures each have one Edit purchase entry. The focused carry-terms
entry edits different fields through the same canonical investment writer; it
must not introduce an independent fee store or endpoint. Valuation contains no
purchase editor or second link to one. Purchase editing and terms editing do not
open simultaneously or discard another draft.

The saved mark appears once in the headline. A different proposed estimate may
appear while editing, but an unchanged saved estimate is not repeated. Purchase
row summaries identify date and price, adding net capital for multiple
purchases; a single purchase does not repeat its headline amount. Expanded
content explains cash, refund and paid components without repeating the net
amount or date. Cash paid is also omitted from a single purchase's detail when
it is the headline. Source date/class labels remain where needed to judge a
valuation. An editor may repeat a fact specifically for editing.

## Task effort

Entry point is the open holding, before any task-specific disclosure or edit.
Count action activations through successful save; required data fields are
listed separately. Prototype scenario selection is outside the product.

| Task                                               | Action budget                                                          | Required new information                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Adopt a supported imported proxy                   | Use proxy estimate: 1                                                  | None; saved shares, date and accepted scope are reused                          |
| Replace a value with a reported value              | Change, choose method if needed, Save valuation: at most 3             | Only the replacement value, source/date and carry classification                |
| Edit a purchase                                    | Expand, Edit purchase, Save purchase: at most 3                        | Changed fields only                                                             |
| Edit known carry terms                             | Edit carry terms, Save terms: 2                                        | Changed rate or basis                                                           |
| Review an unpaid fee                               | Review payment: 1                                                      | None; opens the existing obligation                                             |
| Resolve incomplete share evidence and use a source | Expand purchase, Edit, choose coverage when unresolved, Save, Apply: 5 | Remaining shares/date, missing source valuation date, and a real scope decision |

The last case is a justified exception: deleting a required financial decision
to meet a click target would manufacture evidence. A source's capture date does
not fill its valuation date. Shares covering one purchase do not automatically
cover the remaining position. Ordinary ready cases have no acknowledgement
checkbox or repeated source fields.

## Financial and state cases

| Scenario                        | Expected behavior                                                                                                                                                                                                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purchases, prepaid fees & carry | Cedar reconciles $15,000 original cash, $1,000 refund and $660 fees to $13,340 net invested. The $360 management payment appears once with its coverage. A $16,000 before-carry mark gives $300 carry, $15,700 after carry and 11.33% cumulative simple return after carry using original contributions. Other costs are explicitly excluded. |
| Available proxy                 | $5,940 net invested remains the headline until applying the $17,820 before-carry estimate from 36 evidenced shares at $495. Apply records the selected proxy decision in the simulation. Unknown refund inclusion suppresses return without blocking supported value.                                                                         |
| Incomplete evidence             | Birch shows $7,500 cash paid and known rates. No fee amount, net invested, shares, valuation date, carry or return is invented. The imported price stays visible; only its missing date is requested under valuation. Share count/date and unresolved scope stay in Purchases.                                                                |
| After-carry value & payment due | Maple keeps two independent $100 setup charges and one $100 management payment, giving $9,700 net invested. Its $12,000 after-carry mark is not charged carry again. A separate unpaid $100 obligation due October 31 remains reviewable; any 20% return is labelled before unpaid costs.                                                     |
| No valuation source             | Add valuation reveals the reported-value form; no blank form or empty source selector is shown before that action. Source classification can remain explicitly unspecified, which suppresses unsupported carry calculations.                                                                                                                  |
| No purchases                    | Add purchase is available; no fabricated holding amount, purchase date, price or net-invested total is shown.                                                                                                                                                                                                                                 |
| Save fails once                 | The saved headline stays unchanged. Draft values remain, failure is shown beside the action, and retry works.                                                                                                                                                                                                                                 |
| Source changes                  | Applying an obsolete source fails. Review updated price shows the changed proposal; a separate Apply records the new decision.                                                                                                                                                                                                                |

All calculation operands are integer minor units, ppm or share millionths.
Rendering formats those results. Component fees explain the entered total and
are not added on top of it. A changed refund clears the simulation's prior
distribution-inclusion decision. Unknowns remain distinct from zero.

The link/checkmark interaction previews feedback only; it does not claim a real
clipboard write. Payment review previews navigation to an existing obligation,
not payment execution. Saving, persistence and stale-source handling are local
simulations, not application or API evidence.

## Review before application implementation

The source-backed paid-management coverage is explanatory provenance. This
proposal does not infer future fees from an annual rate or introduce a fee
schedule. The current unified schema lacks structured paid-management coverage;
implementation must preserve that evidence and prove how component amounts and
their source references round-trip through the existing editor before enabling
editing. Any necessary schema or policy extension requires its own review.

Reuse of accepted share coverage must be tied to evidence identity, revision and
scope. Test invalidation on changes to the source, purchase set and remaining
shares; never manufacture confirmation flags. Changing a sourced mark requires
an explicit classification of that replacement. The prototype's local boolean
state is not an implementation specification for these financial decisions.

After exact-version design approval:

1. Map this proposal onto existing shared patterns and complete only required
   gaps/examples before page composition.
2. Extend existing domain/API and desktop/mobile task tests to reject the old
   duplication, double deductions, unsupported calculations and excessive steps.
3. Implement through canonical writers and prove save, reload, changed save,
   rejected save, stale evidence and accepted-state readback.
4. Inspect/replay application screenshots and complete repository verification.

## Approval and evidence record

Approval remains unrecorded. Prototype choices or scenario interactions do not
approve this design.

- Version: Holdings proposal v2, October 6, 2026.
- Content SHA-256:
  `ce76b8841763a5774d9e771afee2918690b40c452d8d25267ded9c2c017e9712`.
- Scope: the standalone synthetic proposal, not application behavior.
- Result: interaction checks and 24 scenario/width combinations passed at 1024,
  390 and 320 pixels. No script errors or horizontal overflow were found;
  visible product controls met 44px height and sibling section headings used the
  same type size. Desktop/mobile and narrow dark-mode captures were reviewed.
- Observed interactions: one-action source adoption, no metadata re-entry,
  mutually exclusive valuation modes, no unchanged resubmit, preserved drafts,
  keyboard save, later edit, failed-save retry, stale-source rejection/review,
  missing share/date/scope gates, fee-component reconciliation, carry editing,
  after-carry preservation and the unpaid-fee navigation.
- Final review removed duplicate single-purchase headline values and owner
  details, and kept the optional reported-value form behind Add valuation.
  Focused assertions reject those regressions; distinct equal charges remain.
- The preview's embedded sandbox blocks native form submission, so the checked
  proposal dispatches local save events and supports Enter explicitly. This is a
  preview adaptation, not a change to application form behavior.
- Evidence: the task-local `holdings-v2-evidence` directory contains the replay
  script, check results, captures and file hashes. It stays outside public Git.

The next gate is the user's approval of this exact proposal. Application code,
API persistence, financial acceptance policy, native visual baselines and
`make verify` remain untested by this proposal-only pass.
