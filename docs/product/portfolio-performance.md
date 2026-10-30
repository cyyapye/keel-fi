# Overview portfolio performance

The homepage keeps the existing hero, goal progress and portfolio charts. Its
summary answers what the portfolio is worth and how supported investments have
performed. Mapped value and top-five concentration describe the holdings chart,
so they remain supporting information beside that chart.

The summary uses existing DataList and Collapsible patterns. Holdings remains
the owner of valuations, invested capital and fees. No new editor or decision
step is introduced. Opening the calculation basis takes one activation and
requires no inputs. The disclosure uses three compact calculation rows: gain
relative to capital for return, remaining value plus returned cash relative to
paid in for TVPI, and returned cash relative to paid in for DPI. Show the
supported amounts, mark displayed amounts as rounded, and retain brief fee and
refund notes. Explain differing TVPI/DPI coverage only when it occurs; keep the
full methodology in this document.

## Meaning and scope

- **Portfolio value:** the existing accepted value total, including cash and
  separately recorded other liquid assets. Unknown values remain excluded.
- **Total return:** a capital-weighted, non-annualized return on supported
  current holdings in the displayed currency. It excludes closed positions, cash
  and unsupported holdings. It is not an account's time-weighted or
  money-weighted return and does not establish lifetime portfolio performance.
- **Private TVPI:** current private remaining value after carry plus returned
  cash, divided by paid-in cash for the same supported holdings.
- **Private DPI:** returned cash divided by paid-in cash. It does not require a
  current valuation, so its eligible cohort may differ from TVPI's.

Show current-holdings scope and eligible/total holding counts without opening a
disclosure. An absent denominator produces an unavailable result, never 0% or
0x. A known zero distribution with positive paid-in capital produces 0x DPI.
Private estimates remain labeled. Value and performance may have different
coverage and value treatments; the calculation disclosure states the amounts and
basis rather than implying the headline portfolio value is the return's
numerator. Returned cash and valuations retain their accepted source dates; the
projection's as-of timestamp is not a new historical valuation date.

## Calculations

Use integer minor units and ratios in parts per million. Sum numerator and
denominator amounts before division; do not average holding percentages. Count
each legal position once regardless of its exposure mappings.

The canonical `calculatePositionPerformance` supplies the return's capital basis
and refund treatment. Private net invested capital is after upfront deductions
and received refunds. A refund already reducing net invested is removed from
distributions when its inclusion was recorded. Public positions use supported
provider cost basis. Missing/stale investment reviews and unreconciled refunds
cannot establish private performance.

TVPI/DPI use reviewed **cash paid**, including separately paid fees, rather than
net invested capital. Received refunds count as returned cash here, while paid
in is unchanged. Add a received refund only when its recorded distribution
treatment is excluded; never double-count an included refund. Unknown refund
inclusion prevents both multiples. A commitment is not evidence of paid-in cash.

Private value must have a current, matching carry treatment. A reported
after-carry value is used directly. A before-carry value uses the existing carry
estimator and reviewed terms; the result is labeled estimated. Do not deduct
upfront fees from value again. Unknown carry prevents private return and TVPI
while independently supported DPI remains available. An invested-amount fallback
cannot establish a valuation or a supported zero return.

## Checked synthetic combinations

All amounts below are integer minor units:

| Case                            | Public value / basis / distributions | Private value after carry / net capital / paid in / distributions                       | Result                                                                                            |
| ------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Mixed supported holdings        | 20,000 / 10,000 / 1,000              | 18,000 / 9,000 / 12,000 / 3,000, including a 1,000 refund                               | Return gain 22,000 on 19,000 basis = 1,157,894 ppm; TVPI 1,750,000 ppm; DPI 250,000 ppm           |
| Same refund separately reported | Unchanged                            | Provider distributions 2,000 plus 1,000 explicitly excluded refund                      | Same results; refund counted once                                                                 |
| Estimated carry                 | Unchanged                            | Before-carry value 20,000; 20% carry over 9,000 net capital => after-carry value 17,800 | Return gain 21,800 = 1,147,368 ppm; TVPI 1,733,333 ppm; DPI unchanged                             |
| Missing private carry treatment | Unchanged                            | Paid in and returned cash supported; value treatment unknown                            | Public-only return, unavailable private TVPI, supported 250,000 ppm DPI; separate coverage counts |

## Read and verification boundaries

This is a pure projection over the existing investment-holdings response and
portfolio-baseline response. It adds zero database/network calls or GET writes.
One linear traversal plus an ID map computes performance. Domain tests include
120 positions, losses, unavailable inputs, refund variants and safe-integer
overflow. Browser assertions retain the fixed one-holdings/one-baseline request
budget, and test ordinary, incomplete, empty, failure/retry and open-basis
states on desktop/mobile. They reject the former headline mapping/concentration
metrics.
