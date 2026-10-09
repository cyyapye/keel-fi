# Holdings concepts before layout

Status: working design analysis for [proposal v3](holdings-ux-proposal-v3.md);
supersedes v2's use of an exception fixture as the default interface. This
document specifies meaning and proposed placement. It does not change accepted
records, schemas, financial policy or the application. A replacement interactive
proposal still needs user approval before application implementation.

## Ordinary investment and its legal identity

The user's stated workflow establishes the default: one investment per legal
SPV, with that investment's applicable terms. The model's allowance for up to 20
purchases is capacity, not evidence that a purchase list belongs on every
screen. The initial proposal must demonstrate this ordinary case independently
of financial stress tests.

An accepted company grouping can link separate legal SPV positions. Each keeps
its owner, cash, fees, purchase price, shares, mark and source history. A second
SPV is not a second purchase inside the first. A reviewed allocation split or
replacement can explain their relationship; neither is inferred from names.
Several payments toward one subscription are payment history, not automatically
separate acquisitions. Actual additional acquisitions inside one vehicle can
reveal transaction detail for that position only.

An ordinary Investment section owns cash paid, refunds, purchase price, shares,
paid fees and contractual terms including carry. It has one Edit entry. Value &
return consumes those facts and shows calculations without a second terms
editor. Use the concise label Shares; dated ownership and coverage requirements
remain in the calculation model. A partial exit justifies explaining shares
still held, not imposing that vocabulary on every untouched investment.

The primary synthetic case has one subscription. The linked case has two legal
SPVs investing in the same company. The complex two-acquisition case below is
retained as an exception regression; it no longer determines the initial screen.

## User questions

1. What cash did I put in, what came back, and what actually bought the shares?
2. What is the position worth, and what deductions affect a proceeds estimate?
3. Who owns the position, and where do its facts come from?

The first two questions organize amounts by their role in the user's
calculation. An expense name or a separate storage table cannot choose its
section.

## Concept and calculation map

| Concept                      | Meaning, scope and timing                                                       | Evidence and calculation relationship                                                                                         | Proposed presentation and editing ownership                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Cash paid                    | Actual contribution per purchase                                                | Accepted purchase amount; refunds preserve the original contribution                                                          | Investment; canonical investment editor                                                                                      |
| Received capital refund      | Cash returned from that contribution                                            | Subtract once when calculating capital retained; add to return proceeds only if excluded from reported distributions          | Same investment; date omitted when absent, without inventing one                                                             |
| Upfront deductions           | Total amount deducted before investing the retained cash                        | Exact purchase total takes precedence over optional rate estimates; do not add component amounts again                        | Same investment and editor; components explain the total                                                                     |
| One-time fee                 | A paid charge or a contractual rate, depending on the evidence                  | A rate needs its basis before it determines a supported amount; a fee and share-price markup are not interchangeable          | Paid amount belongs to purchase costs; rate/basis explains it when useful                                                    |
| Prepaid management fee       | Management charge already paid for an evidenced period and scope                | Paid amount is included once in upfront deductions; rate and covered period explain that payment, not another deduction       | With that purchase cost, including coverage when known; no duplicate charge under valuation                                  |
| Management rate              | Contractual rule with a capital basis, not proof of a payment                   | Rate alone establishes neither paid amount, prepaid duration, nor remaining obligation                                        | Canonical investment terms; reveal with the cost it explains or when editing those terms                                     |
| Future management obligation | Charge for an uncovered future period, if supported                             | Depends on period, scope, basis, prepayment coverage and horizon; do not infer it from an annual label                        | Relevant proceeds calculation only when supported; request only material missing evidence when that calculation is attempted |
| Net invested                 | Capital retained after received refunds and upfront deductions                  | Cash paid minus received refund minus total upfront deductions; display estimate separately if totals are not final           | One summary; purchase detail explains its components, without repeating that same net amount                                 |
| Reported or proxy value      | A position mark or a separately labelled estimate                               | Preserve source/date/class and method; a missing mark may fall back to labelled invested capital, not a market-value claim    | Headline; valuation owns its source, method and single edit action                                                           |
| Carry terms and deduction    | Contractual rate/basis versus a calculated deduction on eligible positive gains | Apply the reviewed basis and mark's before/after-carry classification; never charge an already-after-carry mark again         | Contractual terms in Investment; calculated deduction beside the value it affects, with no second editor                     |
| Return                       | Performance relative to its defined contribution basis                          | Distribution/refund reconciliation and fee treatment matter; net share capital is not automatically the return or carry basis | Alongside its corresponding headline value when supported; a known mark remains visible when return is not calculable        |

Representation is not duplication: a rate can explain a charge and components
can explain a total. Those relationships must be visible where needed, and the
calculation must apply the underlying charge once. Separate purchases can have
equal amounts; repeated text or numbers alone do not prove duplicate economics.

## Layout decision for proposal v3

- **Investment** contains the amount actually paid or returned, paid fees and
  that investment's applicable terms. A single investment is visible directly;
  only evidenced multiple acquisitions reveal a Transactions list. Contractual
  carry remains here even before a supported valuation exists.
- **Value & return** answers the second. Carry or supported remaining costs
  appear with the result they change. A lone carry rate does not earn a separate
  top-level Fees & carry section or a second edit action. Rates without
  sufficient calculation evidence remain inspectable/editable as terms, without
  fabricating net proceeds or presenting optional completion as an urgent
  warning.
- The heading answers who owns the position. **Sources & history** provides its
  supporting provenance without repeating the owner, vehicle, purchase or
  valuation summaries.

The proposal uses the existing canonical investment writer for amounts and
shared terms, with one Investment edit entry rather than independent fee
writers. Its entry and focus behavior still need to be demonstrated in the
replacement mockup. A shared writer does not require all its fields to be
visible together.

## Combined synthetic exception

All figures below are synthetic design fixtures. Exact inputs are integer cents.
They demonstrate expected relationships, not newly accepted production facts.

Purchase A: cash paid 1,000,000 cents; received refund 100,000; upfront total
56,000; net invested 844,000. Source evidence identifies setup 20,000 and
prepaid management 36,000 within that total. The management notice states 20,000
ppm per year on 900,000 cents for Jan 2026 through Dec 2027. The paid amount is
explicit; the rate is explanatory, not an additional expense. Coverage
explicitly includes the later purchase. Nothing establishes charges after that
period.

Purchase B: cash paid 500,000 cents; setup and upfront total 10,000; net
invested 490,000. It has no additional management payment. The position
therefore has:

| Quantity                                | Expected cents | Check                                        |
| --------------------------------------- | -------------- | -------------------------------------------- |
| Cash paid                               | 1,500,000      | Sum contributions                            |
| Received refund                         | 100,000        | One receipt                                  |
| Cash retained                           | 1,400,000      | Paid minus refund                            |
| Upfront deductions                      | 66,000         | Sum totals, not totals plus their components |
| Net invested                            | 1,334,000      | Retained minus deductions                    |
| Prepaid management within upfront total | 36,000         | One charge, not one copy per purchase        |

With a reviewed before-carry mark of 1,600,000 cents and 150,000 ppm carry above
reviewed cash retained, positive gain for this illustration is 200,000 cents;
carry is 30,000; the value after carry is 1,570,000. Do not substitute the lower
net-share-capital basis or claim this is complete net proceeds after all future
fees, taxes and expenses. The refund is separately recorded as excluded from
reported distributions, and there are no other distributions in this fixture.

## Holdouts and enforcement targets

| Case                           | Required result                                                                    | Old error the check must reject                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Annual fee prepaid             | Retain paid amount, coverage and rate as related facts                             | Treating the same annual rate as an additional future charge during its paid coverage          |
| Multiple purchases             | Each charge counted once at its evidenced scope                                    | Copying a position-wide prepaid charge onto every purchase                                     |
| Fee components and total       | Components explain total, never add to it again                                    | Subtracting setup plus management plus their already-inclusive total                           |
| Rate-only notice               | Preserve missing basis/timing/amount; no invented accepted fee or remaining shares | Inferring all annual fees are unpaid, or using an unclassified rate as confirmed share capital |
| After-carry mark               | No second carry deduction                                                          | Applying carry solely because a rate exists                                                    |
| Refund without date            | Received amount affects retained capital once; date remains absent                 | Turning it into a fee or inventing a receipt date                                              |
| Comparable independent charges | Preserve both, even with equal labels or amounts                                   | A duplicate-string rule deleting a legitimate charge                                           |

## Metric definitions for proposal v2

All monetary calculations use integer cents; rates use parts per million and
shares use millionths. The display formatter does not calculate money. The
following definitions apply only when the corresponding evidence is established.

| Metric                    | Definition and scope                                                                                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original cash contributed | Sum accepted cash paid, retained as contribution history. This is not the net-capital return denominator.                                                                                                             |
| Cash retained             | Original cash contributed minus received capital refunds. This is the reviewed cash basis for the synthetic carry illustration.                                                                                       |
| Net invested              | Cash retained minus accepted upfront deduction totals. A component explains its total and is not deducted again. If those totals are unknown, show the known cash amount with its own label.                          |
| Share estimate            | Dated remaining shares, with accepted whole-position coverage, multiplied by the selected dated share price. Round once to cents. No share count is inferred from original cash.                                      |
| Illustrative carry        | Positive excess of a before-carry mark over its reviewed basis, multiplied by the carry rate. Do not subtract carry from an after-carry mark; unknown classification/basis prevents this illustration.                |
| Value after carry         | Before-carry mark minus illustrative carry. Keep the source mark separate; qualify an excluded cost only when a recorded obligation or source limitation supports it.                                                 |
| Cumulative simple return  | (Selected value plus distributions excluding capital refunds minus net invested capital) divided by net invested capital. Label the selected value's carry/cost treatment. Unknown refund inclusion withholds return. |

For Cedar's combined fixture, original cash is 1,500,000 cents, retained cash
1,400,000, deductions 66,000 and net invested 1,334,000. The before-carry mark
is 1,600,000, carry 30,000 and the carry-only illustration 1,570,000. Both
returns use net invested of 1,334,000 cents. The received refund already reduces
that basis and is not added to proceeds. The before-carry gain is 266,000 cents
and return 19.94%; after-carry gain is 236,000 cents and return 17.69%. Show
each supported return with its corresponding value: 1,600,000 cents before carry
with 19.94%, and 1,570,000 cents after carry with 17.69%. Net invested remains a
separate capital measure and the denominator for both returns. If only an
after-carry source value is available, preserve that value and supported return
without inventing a before-carry counterpart. Name specific evidenced excluded
costs rather than adding a generic cost disclaimer.

The v2 due-payment fixture retains two independent setup charges of 10,000 cents
each and one management payment of 10,000 referenced by both purchases. Total
paid deductions are 30,000 and net invested is 970,000 against original cash of
1,000,000. An additional accepted management obligation of 10,000 is unpaid, due
October 31, and remains an action in the existing Obligations workflow. It is
not a historical deduction. Its 1,200,000 after-carry mark is not reduced by
carry again; the displayed 23.71% return names the excluded $100 unpaid
management fee. This fixture demonstrates a valid fee action without reinstating
a generic Fees & carry section.

The incomplete fixture has 750,000 cents paid, rate-only notices and a captured
45,000-cent price without a valuation date or remaining-share evidence. It has
no supported net-invested, share-estimate, carry or return result. The prototype
shows known cash and rates; the selected estimate asks only for its missing date
and directs share entry to the existing purchase editor. Whole-position coverage
requires an explicit decision when no accepted coverage exists.

These targets belong in existing domain/API and task browser tests after design
approval. Semantic section review remains a separate gate; a linter cannot
establish that two headings answer distinct user questions. A mockup must
include the combined case and incomplete evidence, not just the previous easy
fixture.

## Current implementation limits

The current model already distinguishes purchase `upfrontDeductionsMinor` from
position terms `annualManagementFeePpm`/basis and `carryPpm`/basis. The unified
terms schema does not encode a structured paid-management coverage schedule. The
legacy economics flow and unified investment policy also have different
prepaid-term handling. Trace that transition before implementing any new
remaining-fee calculation; this map does not authorize a migration or a shortcut
that multiplies an annual rate and assumes it is paid or due.

References checked for this map:

- [Source-update policy](../architecture/source-update-policy.md): exact
  allocation amounts, optional rate estimates, refund inclusion and carry.
- [Purchase schema](../../packages/domain/src/position-purchases.ts): accepted
  cash, deductions, refund and share evidence.
- [Investment terms and calculations](../../packages/domain/src/investment-details.ts):
  independent nullable rates, reviewed mark classification and integer carry.

Review result: the old top-level fee split fails the section rationale. The
replacement placement above is ready to guide a new mockup; interaction design
and any required domain-model extensions remain unapproved.
