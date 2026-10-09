# Holdings UX pilot

Status: v1 superseded after review of the fee-section boundary. It is not an
implementation target. The [concept map](holdings-concept-map.md) now precedes
[Holdings proposal v3](holdings-ux-proposal-v3.md), which defaults to one
investment per legal SPV and keeps separate SPVs linked. V2 is also superseded.
Application implementation and acceptance-policy changes still require the
applicable design and domain gates. No new mockup has been approved.

The historical interactive **Holdings UX proposal v1** remains in the task
conversation with its frozen content digest below. Its passing interaction
checks did not establish that its information architecture was sound.

## Task and ownership

The following describes the historical v1 proposal. Its standalone Fees & carry
owner is superseded by the concept map's section rationale. Do not implement
this table as the current design.

The user should understand a position and adopt or change its valuation without
re-entering existing purchase or source information. This pilot uses synthetic
Demo Cedar AI data, not a user's holding. The price source is synthetic too.

| Information or action                                    | Owner                                            | Presentation elsewhere                                                            |
| -------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| Paid cash, received refunds, purchase fees, share counts | Purchases; one Edit action per expanded purchase | Valuation consumes saved evidence without duplicate purchase fields or edit links |
| Selected source price and its metadata                   | Value & return                                   | Source metadata supplied automatically; manual mode replaces source selection     |
| Current accepted value                                   | Headline                                         | Value & return shows its method, not another copy of the headline amount          |
| Proposed value before saving                             | Value & return                                   | Headline continues to show the saved value or labelled net-invested fallback      |
| Ownership and source history                             | Ownership, sources & history                     | Position identity in the heading remains useful context                           |
| Carry and ongoing terms                                  | Fees & carry                                     | A concise before-carry label accompanies estimates where material                 |

Default task: adopt the available proxy using saved, dated remaining shares and
current whole-position coverage evidence. Budget: one Use proxy estimate action
from the opened position. Change an existing valuation: Change, select Manual
valuation, Save valuation (three actions, new evidence fields counted
separately). Edit a purchase: expand its row, Edit purchase, Save purchase
(three actions). The proposal leaves Purchases and Value & return visible so
opening unrelated sections is unnecessary. These budgets include all product
action activations; prototype scenario controls are outside the product and are
not task steps.

## Financial boundary to settle before application work

The current [source-update policy](../architecture/source-update-policy.md)
requires original-share and whole-position coverage confirmations for share
estimates. The proposal removes the blanket checkbox only where valid accepted
remaining-share and coverage evidence already resolves those questions. A later
implementation must explicitly specify and test evidence revision, scope and
invalidation rules before reusing those decisions. It must not set confirmation
flags true simply because a purchase exists or a checkbox disappeared.

When remaining shares cannot be supported, the source price alone cannot value
the position. The incomplete scenario leaves the source readable and explains
the missing prerequisite locally. Purchases owns its correction; manual total
valuation remains an alternative. It does not show a fabricated value, assert no
sales, or infer a refund date. Unresolved distribution treatment suppresses
return, without blocking a separately supported position valuation.

The ordinary synthetic case has 36 evidenced remaining shares, $6,600 paid,
$600
received refund, $60 evidenced upfront fee, $5,940 net invested, and a
$495
Common proxy for Preferred shares. Its $17,820 estimate is before carry. The
multiple-purchase case adds 20 shares at $150, with $3,000 paid and no fees: 56
remaining shares, $8,940 net invested and a $27,720 proxy estimate. These
figures deliberately have explicit fee bases and share evidence; the proposal
does not resolve missing evidence in an existing record by analogy.

## Eight corrections mapped to rules

| Regression                           | Required behavior                                                 | Verification after implementation                                                                       |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Filler valuation subtitle            | Heading stands alone; each remaining sentence supports a decision | Copy review and browser absence assertion for the retired subtitle                                      |
| Optional refund notice               | No notice unless it affects the current action or shown result    | Incomplete distribution treatment fixture has no global warning and no claimed return                   |
| Duplicate Add share details link     | Purchases owns editing                                            | Exactly one canonical purchase edit entry per expanded purchase                                         |
| Duplicate Edit share details link    | No cross-editor link in valuation                                 | Valuation region contains no purchase-edit action                                                       |
| Redundant Share details section      | Valuation consumes purchase evidence without repeating it         | No purchase detail section or purchase inputs in valuation                                              |
| Re-entry of known source information | Imported mode uses the source record                              | No manual fields in imported mode; saved source identity and revision read back                         |
| Blanket coverage checkbox            | Reuse supported decisions; ask only unresolved questions          | Ready case completes without checkbox; incomplete and stale-evidence holdouts cannot fabricate coverage |
| Imported and manual forms together   | Exactly one active valuation method                               | Switching methods removes inactive form controls and preserves the draft                                |

## Scenario and evidence checklist

Each row needs interaction proof and desktop/mobile inspection in the proposal.
After approval, port these cases into the existing purchase and Holdings browser
tests, paired with financial/API readback tests. The table is a specification,
not a claim that application regressions already exist or pass.

| Case                          | Observable acceptance                                                                                 | Negative control                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Ready imported proxy          | One action, zero inputs; saved method visible; no duplicate estimate                                  | Add an acknowledgement step or source field and fail the task budget  |
| Multiple purchases and refund | All supported remaining shares contribute; cash/refund shown once per purchase; no unknown date       | Drop a lot or duplicate a refund and fail the expected integer result |
| Missing remaining shares      | No invented estimate; canonical purchase editor resolves the actual prerequisite                      | Supply only a price and reject application of a share estimate        |
| No price source               | Manual valuation opens; no empty imported source block                                                | Render an empty source selector and fail visibility assertions        |
| Manual alternative            | Choosing manual hides source selection; returning restores the draft                                  | Show both active modes and fail the exclusive-state assertion         |
| Saving and failure            | Action shows Saving; repeated submit blocked; rejection preserves fields and saved value; retry works | Clear the draft on rejection or update the headline prematurely       |
| Later edit                    | Change exposes the saved method; changed save updates the result                                      | Leave Apply active for an unchanged draft                             |
| Stale evidence                | Retain draft, reject obsolete source/coverage, require only changed decisions                         | Auto-accept changed source evidence using old confirmation flags      |
| Optional gaps                 | Missing dates and zero fees omitted; no fabricated return or warnings                                 | Coerce missing data to zero or display Unknown as a summary value     |
| Mobile and keyboard           | No overflow at 320px; labelled controls, visible focus, 44px targets, correct focus after save/cancel | Hide primary action behind hover or clipped content                   |

Prototype interactions simulate saves locally. They do not establish D1
persistence, API validation, concurrency behavior, full accessibility, or native
application screenshot coverage. Stale-evidence rejection and actual reload
readback require application tests after approval, not a simulated green badge.

## Delivery gates

1. **Concept review and replacement proposal:** use the concept map and
   challenge the entire section structure before drawing. Include prepaid
   management, multiple purchases, carry and incomplete evidence together; the
   old easy fixture is insufficient. Resolve policy/model gaps, then prepare and
   inspect v2's complete interactions and present that exact version for
   approval. No application UI changes precede this gate.
2. **Shared patterns:** after approval, inventory existing components; finish
   only required gaps and examples for section hierarchy, owned editing,
   mutually exclusive valuation methods and save feedback. Domain calculations
   remain app-local. Pattern examples precede page composition.
3. **Behavioral enforcement:** extend `scripts/shared-ui-usage.test.ts` only for
   structural invariants it can prove. Add state/effort assertions to existing
   browser tests and financial holdouts to existing unit/API tests. Demonstrate
   each old failure is rejected. Register desktop/mobile cases in
   `.tugling/pilot-cases.json` where required.
4. **Approved Holdings implementation:** exercise save, reload, changed save,
   rejected save and stale evidence; inspect all changed desktop/mobile images;
   replay without baseline updates; run repository-native verification. A PDF
   sandbox failure remains a blocker to claiming `make verify` passed.
5. **Reuse:** validate one second surface before generalizing new patterns.
   Compare baseline and candidate guidance with the independent synthetic
   [evaluation cases](../engineering/agent-guidance-evaluation.md). Structural
   validation alone cannot prove that future agents will follow the rules.

No unconditional promise of flawless output: the release criterion is observable
prevention of the recorded failures, design approval for new concepts, and
explicit reporting of unverified boundaries.

## Proposal record

- Version: Holdings UX proposal v1.
- Approval: not approved; superseded after the fee-section correction.
- Content digest (SHA-256):
  `11419254ec70c4915a5532a45cd5d31e6786576a3a102d9b897b227f7111d115`.
- Application enforcement: planned after approval, not yet implemented.
- Guidance evaluation: see the independent concept-review comparison in
  [agent-guidance evaluation](../engineering/agent-guidance-evaluation.md). Its
  scope does not validate every earlier UX proposal case.

Proposal verification on 2026-10-05 passed in an isolated headless browser:
one-action imported save, saving feedback, exclusive methods, retained drafts,
unchanged-submit prevention, keyboard submission, changed save, multi-purchase
totals, missing-share correction, failed-save retry, stale-source rejection and
explicit review. All six scenarios passed overflow checks at 1024, 390 and 320
pixels (18 combinations), including expanded purchase and error forms. Visible
mobile controls met the 44px height check. Desktop and mobile captures were
inspected. No browser script errors were observed. The prototype uses integer
arithmetic for monetary calculations.

Changed-document formatting, local Markdown links, UI skill structural
validation and the public-data safety scan passed. No application code or
snapshot was changed by this stage, and no application `make verify` result is
claimed. The prototype simulates local state; its source-refresh and save
interactions are not API or financial-policy validation.
