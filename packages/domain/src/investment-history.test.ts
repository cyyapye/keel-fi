import { it, expect } from "vitest";
import {
  reconcileInvestmentQuantity,
  InvestmentHistoryQuerySchema,
  type InvestmentHistoryContext,
} from "./investment-history";
const context: InvestmentHistoryContext = {
  readContextId: "synthetic-capture",
  accountId: "container:synthetic-account",
  positionId: "synthetic-position",
  capturedAt: "2026-11-11T06:00:00Z",
  providerUpdatedAt: "2026-11-11T05:00:00Z",
  quantityEffectiveOn: null,
  priceAsOf: "2026-11-10",
  holdingsSnapshotId: "synthetic-closing",
  coverage: {
    status: "complete",
    requestedFrom: "2026-11-01",
    requestedThrough: "2026-11-10",
    lastSuccessfulSyncAt: "2026-11-11T06:00:00Z",
    missingPeriods: [],
    scope: "provider_reported_window",
  },
  lastAttemptStatus: "succeeded",
};
const input = {
  context,
  openingSnapshotId: "synthetic-opening",
  openingOn: "2026-11-05",
  openingQuantityMicros: 80_000_000,
  closingOn: "2026-11-10",
  closingQuantityMicros: 110_000_000,
  quantityDateBasis: "posting_date" as const,
  transactions: [
    {
      postedOn: "2026-11-09",
      type: "buy" as const,
      quantityMicros: 40_000_000,
    },
    {
      postedOn: "2026-11-10",
      type: "sell" as const,
      quantityMicros: -10_000_000,
    },
  ],
};
it("establishes inclusion only from a covered comparable quantity interval", () => {
  expect(reconcileInvestmentQuantity(input)).toMatchObject({
    status: "reconciled",
    expectedQuantityMicros: 110_000_000,
    unexplainedQuantityMicros: 0,
    cashStatus: "not_established",
    basisStatus: "broker_reported_not_reconstructed",
  });
  expect(
    reconcileInvestmentQuantity({
      ...input,
      closingQuantityMicros: 115_000_000,
    }),
  ).toMatchObject({
    status: "unexplained_difference",
    unexplainedQuantityMicros: 5_000_000,
  });
  expect(
    reconcileInvestmentQuantity({ ...input, quantityDateBasis: "unknown" }),
  ).toMatchObject({
    status: "insufficient_timing",
    expectedQuantityMicros: null,
  });
  expect(
    reconcileInvestmentQuantity({
      ...input,
      context: {
        ...context,
        coverage: { ...context.coverage, status: "partial" },
      },
    }).status,
  ).toBe("insufficient_coverage");
  expect(
    reconcileInvestmentQuantity({
      ...input,
      transactions: [
        {
          postedOn: "2026-11-09",
          type: "transfer",
          quantityMicros: 30_000_000,
        },
      ],
    }).status,
  ).toBe("insufficient_coverage");
});
it("requires an unambiguous account or position scope and ordered dates", () => {
  expect(InvestmentHistoryQuerySchema.safeParse({}).success).toBe(false);
  expect(
    InvestmentHistoryQuerySchema.safeParse({
      accountId: "synthetic-account",
      positionId: "synthetic-position",
    }).success,
  ).toBe(false);
  expect(
    InvestmentHistoryQuerySchema.safeParse({
      positionId: "synthetic-position",
      from: "2026-11-10",
      through: "2026-11-01",
    }).success,
  ).toBe(false);
  expect(
    InvestmentHistoryQuerySchema.safeParse({
      positionId: "synthetic-position",
      sync: true,
    }).success,
  ).toBe(false);
});
