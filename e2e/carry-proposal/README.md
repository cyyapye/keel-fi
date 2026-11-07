# Distribution proposal v5

This synthetic proposal records received SPV distributions and shows their
effect on remaining carry and historical return. User approval is pending. It
uses no production route, API write, browser storage, or D1 state. Refresh
resets its memory to the ordinary scenario.

The holding summary shows saved values. Investment keeps cash paid, fees, carry
terms, and distributions together. Return calculation explains net invested and
provider reconciliation. Carry details shows the contributed-capital hurdle. The
editor labels its current draft as Proposed effect, with separate values for
remaining proceeds and estimated carry.

Amount fields determine whether a value is known. A blank amount records
Unknown. An entered zero records known zero. Nonempty invalid amounts cannot be
saved. Historical values and prior carry amounts are never inferred from current
prices, missing charges, or the size of investor distributions. Complete empty
history requires confirmed zero prior carry. Received dates, evidence, and an
actual history-through date remain required. Stock identity and quantity are
optional, and a supplied quantity must be positive.

Distribution rows distinguish the amount, asset identity, received date, and
source. A shared statement retains their historical after-advisor-carry basis.
History triggers keep their caret beside the title and their timestamp in
secondary text and accessible description. The multiple-distribution scenario
covers long asset, source, and history labels.

`model.ts` adapts drafts to production domain types and calls
`assessInvestmentCarry`, `summarizeInvestmentCarryCapital`,
`reconcileHistoricalProceeds`, and `calculatePositionPerformance`. It defines no
separate financial formulas. The ordinary synthetic example contributes
3,000,000 cents, deducts 300,000 cents upfront, records 900,000 cents received
by the investor, and has 4,000,000 cents remaining. At 200,000 ppm carry, its
capital still to return is 2,100,000 cents, remaining carry is 380,000 cents,
and proceeds are 3,620,000 cents. The returns display +81.5% before remaining
carry and +67.4% after carry. Historical investor distributions are already
after advisor carry.

Unknown prior carry preserves known investor capital returned and withholds the
carry estimate. Unknown or mixed provider inclusion withholds dependent returns.
Unknown source treatment remains Carry unspecified. An after-carry source passes
through without another deduction. Distributions create no brokerage holding and
never change remaining shares.

Successful memory saves append mock receipts. Stable event IDs survive edits.
Removing an event changes the latest snapshot while earlier receipts remain
readable. Failed saves retain their draft and allow retry. Held saves disable
all distribution form controls until the explicit prototype completion action.

Build and verify with the existing server on port 14811.

```sh
node e2e/carry-proposal/build.mjs
node node_modules/vitest/vitest.mjs run --config e2e/carry-proposal/vitest.config.ts
node node_modules/typescript/bin/tsc --noEmit -p e2e/carry-proposal/tsconfig.json
node node_modules/eslint/bin/eslint.js e2e/carry-proposal --max-warnings=0
node node_modules/prettier/bin/prettier.cjs --check e2e/carry-proposal
node e2e/carry-proposal/verify-browser.mjs
```

The browser script accepts `CARRY_PROPOSAL_URL`, defaulting to
`http://127.0.0.1:14811`. It checks 1778 by 1566, 1280 by 900, and 390 by 844
viewports. It exercises amount knowledge transitions, invalid drafts, changed
saves, retry, held submission, rapid keyboard input, cash and stock, source
treatment, provider inclusion, and historical receipts. Natural keyboard
traversal checks visible, unobscured focus without centering or forcing
component state. Geometry checks require no horizontal overflow, controls at
least 44px high on mobile and 40px high on desktop, and history carets beside
their title text. Type measurements check the amount, identity, and metadata
hierarchy. Paired one-line form labels align their controls, and descriptions
remain below inputs. Editor focus moves at commit time, so a deferred
animation-frame callback cannot steal a user's selected input after editing
starts.

Evidence goes to `.keel-local/carry-development/proposal/evidence-v5/`. Earlier
proposal artifacts remain unchanged. Raw logs and a verification index identify
the source, bundle, captures, and commands. The frozen v5 bundle lives under
`proposal/approval-v5/site` after verification.

Model the Domain removes duplicate knowledge state from the draft. Test
Behavior, Not Implementation shapes save, readback, rejection, and keyboard
assertions. This unit adds no source comments. Parent-owned independent visual
review, exact user approval, production UI implementation, real API and D1
browser persistence, full application verification, and canonical Linux pixels
remain outside this proposal correction.
