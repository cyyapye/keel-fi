import { expect, test } from "vitest";
import { HoldingSchema } from "@keel/domain";
import { investmentHoldingsViewFor } from "../../../scripts/test-support/investment-holdings-view";
import { buildHoldingsSearchIndex, searchHoldings } from "./collection-search";

test.each([120, 1_000])(
  "searches all %i holdings before pagination",
  (size) => {
    const holdings = Array.from({ length: size }, (_, index) =>
      HoldingSchema.parse({
        id: `position_search_${index}`,
        companyId: null,
        positionName:
          index === 0 ? "Café Nebula Series A" : `Demo Security ${index}`,
        exposureName: index === 0 ? "Café Nebula" : `Demo Exposure ${index}`,
        ownerLabel: "Demo Brokerage",
        positionKind: "direct",
        administratorNavMinor: (index + 1) * 10_000,
        administratorNavState: "reported",
        externalMarkMinor: null,
        underwritingValueMinor: null,
        scenarioValueMinor: null,
        usableLiquidityMinor: null,
        sourceStatus: "verified",
        sourceLabel: "Plaid Investments",
        effectiveDate: "2026-08-16",
        retrievedAt: "2026-08-16T12:00:00.000Z",
        confidencePpm: null,
        ticker: index === 0 ? "NEB1" : `DMO${index}`,
        quantityMicros: 1_000_000,
        costBasisMinor: null,
      }),
    );
    const data = investmentHoldingsViewFor(holdings);
    const before = structuredClone(data);
    const index = buildHoldingsSearchIndex(data, []);
    for (const query of [" CAFE — nebula ", "NEB1"]) {
      const found = searchHoldings(index, query)!;
      expect([...found.positionIds]).toEqual(["position_search_0"]);
      expect(
        [...found.exposurePositions.values()].map((ids) => [...ids]),
      ).toEqual([["position_search_0"]]);
      expect(found.resultLabel).toBe("1 exposure · 1 position");
    }
    const all = searchHoldings(index, "Robinhood")!;
    expect(all.positionIds.size).toBe(size);
    expect(all.exposurePositions.size).toBe(size);
    expect(all.resultLabel).toBe(`${size} exposures · ${size} positions`);
    expect(searchHoldings(index, `DMO${size - 1}`)!.positionIds).toContain(
      `position_search_${size - 1}`,
    );
    expect(searchHoldings(index, "no matching record")!.resultLabel).toBe(
      "0 results",
    );
    expect(searchHoldings(index, " — ")).toBeNull();
    expect(data).toEqual(before);
  },
);
