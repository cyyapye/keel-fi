import { describe, expect, it } from "vitest";

import { AcceptPositionValueAdjustmentInputSchema } from "./position-value";

const input = {
  expectedSnapshotId: "snapshot_synthetic",
  expectedAdjustmentId: null,
  valueMinor: 1_250_000,
  currency: "USD",
  effectiveDate: "2026-08-16",
  sourceKind: "gp_update" as const,
  sourceLabel: "Synthetic Q2 GP update",
  sourceUrl: null,
  commentary: "Synthetic company progress supports this reviewed mark.",
};

describe("position value evidence", () => {
  it("accepts a sourced GP mark without manufacturing a link", () => {
    expect(
      AcceptPositionValueAdjustmentInputSchema.safeParse(input).success,
    ).toBe(true);
  });

  it.each([
    null,
    "http://news.example/mark",
    "https://user:pass@news.example/mark",
  ])(
    "rejects news evidence without a safe HTTPS source URL: %s",
    (sourceUrl) => {
      expect(
        AcceptPositionValueAdjustmentInputSchema.safeParse({
          ...input,
          sourceKind: "news_article",
          sourceUrl,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts news evidence with a safe HTTPS source URL", () => {
    expect(
      AcceptPositionValueAdjustmentInputSchema.safeParse({
        ...input,
        sourceKind: "news_article",
        sourceUrl: "https://news.example/synthetic-mark",
      }).success,
    ).toBe(true);
  });
});
