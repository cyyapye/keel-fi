# Product and calculation principles

1. D1 is canonical; the browser is a view and draft editor.
2. Financial calculations are deterministic and testable.
3. Imported facts carry evidence, effective date, retrieval date, source,
   confidence, and review status.
4. External events create proposals, never silent holding mutations.
5. Paper value, underwritten value, usable liquidity, and actual distributions
   are separate concepts.
6. Forecast versions are append-only.
7. Synthetic examples demonstrate the product without leaking a real portfolio.

## Projection contract

Annual cumulative liquidity curves record P25, P50, P75, expected liquidity, and
probability of zero liquidity in parts per million. Conditional economic value
answers “what could this be worth if the economic outcome occurs.”
Timing-adjusted liquidity additionally accounts for whether and when value can
become usable.

Money arithmetic uses integer minor units. Display formatting may abbreviate
values but never changes stored or calculated values.

## Evidence review

Accept, reject, and scenario-only are explicit, one-way decisions. Acceptance
records both the prior and replacement values. Acceptance alone does not mutate
a mark or lot; a subsequent workflow creates the accepted record and a new
forecast snapshot with attribution.
