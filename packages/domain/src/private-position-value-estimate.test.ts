import { describe, expect, it } from "vitest";

import {
  estimatePrivatePositionValues,
  PRIVATE_TRANCHE_MATCH_MAX_DAYS,
  type PrivateCompanyRoundValuation,
  type PrivatePositionEstimateCandidate,
} from "./private-position-value-estimate";

function candidate(
  overrides: Partial<PrivatePositionEstimateCandidate>,
): PrivatePositionEstimateCandidate {
  return {
    positionId: "position_target",
    companyId: "company_synthetic",
    openedOn: "2024-06-15",
    currency: "USD",
    costBasisMinor: 10_000_000,
    currentValueMinor: null,
    markEffectiveDate: null,
    markSourceLabel: null,
    estimateEligible: true,
    ...overrides,
  };
}

function valuation(
  overrides: Partial<PrivateCompanyRoundValuation>,
): PrivateCompanyRoundValuation {
  return {
    companyId: "company_synthetic",
    evidenceEventId: "event_series_b",
    effectiveDate: "2024-06-01",
    postMoneyValueMinor: 100_000_000_000,
    currency: "USD",
    sourceTitle: "Synthetic Series B",
    sourceUrl: "https://example.com/synthetic-series-b",
    approximate: false,
    ...overrides,
  };
}

describe("private position value estimates", () => {
  it("transfers a GP mark across entry rounds without rewriting cost basis", () => {
    const estimates = estimatePrivatePositionValues(
      [
        candidate({
          positionId: "position_reference",
          openedOn: "2023-03-10",
          costBasisMinor: 20_000_000,
          currentValueMinor: 60_000_000,
          markEffectiveDate: "2026-08-20",
          markSourceLabel: "Synthetic GP portal",
          estimateEligible: false,
        }),
        candidate({
          positionId: "position_target",
          openedOn: "2024-06-15",
          costBasisMinor: 10_000_000,
        }),
      ],
      [
        valuation({
          evidenceEventId: "event_series_a",
          effectiveDate: "2023-03-01",
          postMoneyValueMinor: 50_000_000_000,
        }),
        valuation({
          evidenceEventId: "event_series_b",
          effectiveDate: "2024-06-01",
          postMoneyValueMinor: 100_000_000_000,
        }),
      ],
    );

    expect(estimates).toEqual([
      expect.objectContaining({
        positionId: "position_target",
        costBasisMinor: 10_000_000,
        impliedCompanyValueMinor: 150_000_000_000,
        valueMinor: 15_000_000,
        referencePositionId: "position_reference",
        effectiveDate: "2026-08-20",
      }),
    ]);
  });

  it("fails closed without a nearby accepted round for either tranche", () => {
    const outsideWindow = new Date("2024-06-15T00:00:00.000Z");
    outsideWindow.setUTCDate(
      outsideWindow.getUTCDate() + PRIVATE_TRANCHE_MATCH_MAX_DAYS + 1,
    );
    const estimates = estimatePrivatePositionValues(
      [
        candidate({
          positionId: "position_reference",
          openedOn: "2023-03-10",
          currentValueMinor: 30_000_000,
          markEffectiveDate: "2026-08-20",
          markSourceLabel: "Synthetic GP portal",
          estimateEligible: false,
        }),
        candidate({}),
      ],
      [
        valuation({
          evidenceEventId: "event_reference",
          effectiveDate: "2023-03-01",
        }),
        valuation({
          evidenceEventId: "event_too_far",
          effectiveDate: outsideWindow.toISOString().slice(0, 10),
        }),
      ],
    );

    expect(estimates).toEqual([]);
  });

  it("does not override a position that already has a current mark", () => {
    expect(
      estimatePrivatePositionValues(
        [
          candidate({
            positionId: "position_reference",
            currentValueMinor: 30_000_000,
            markEffectiveDate: "2026-08-20",
            markSourceLabel: "Synthetic GP portal",
            estimateEligible: false,
          }),
          candidate({
            currentValueMinor: 12_000_000,
            markEffectiveDate: "2026-08-19",
            markSourceLabel: "Synthetic administrator",
            estimateEligible: false,
          }),
        ],
        [valuation({})],
      ),
    ).toEqual([]);
  });
});
