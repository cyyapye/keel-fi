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
8. Public-source reliability and model confidence are separate measurements.
9. A company-level financing signal is not automatically a holding-level mark.
10. A legal position and its economic exposure are separate records. Each
    position belongs to one ownership container and may map to multiple
    exposures.
11. The same exposure held through different accounts, tax wrappers, or legal
    vehicles remains separate positions.
12. A missing observation is scoped to the exact connection and completely
    covered ownership container. It never implies a sale, closed account, or
    zero value.
13. A reviewed baseline counts each accepted position snapshot at most once.
    Exposure views group positions without merging them or creating additional
    value.

The interface and copy acceptance criteria live in
[`ui-and-copy.md`](./ui-and-copy.md). The canonical relationship model for
institutions, accounts, positions, SPVs, and shared exposures lives in
[ADR 005](../architecture/adr-005-multi-source-holdings-identity.md).

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

## Public-source monitoring

Portfolio Watch retains the directly observed fact, source class, publication
and retrieval times, and an immutable fingerprint before recording any derived
valuation estimate. Inference is labeled separately with its own confidence,
range, assumptions, and limitations. Public reports can create proposals, but
they never become administrator NAV, accepted marks, or usable liquidity by
themselves.
