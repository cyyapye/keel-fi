import { expect, it } from "vitest";
import { createCostFixtureDatabase } from "./test-support/cost-database";

it("keeps reconnect subject binding indexed across positive, empty, foreign and growing history", async () => {
  const fixture = await createCostFixtureDatabase({
    operation: "provider-reconnect",
  });
  try {
    if (fixture.initialResult?.operation !== "provider-reconnect")
      throw new Error("Expected reconnect cost results");
    const { results } = fixture.initialResult;
    expect(results.map((row) => row.history)).toEqual([120, 1200]);
    for (const row of results) {
      expect(row.leasedSessionId).toBe(row.createdSessionId);
      expect(row.viewerSubject).toBe("synthetic-access-subject");
      expect(row.positive.roundTrips).toBeLessThanOrEqual(7);
      expect(row.positive.rowsRead).toBeLessThanOrEqual(40);
      expect(row.plan).toMatch(/SEARCH session USING INDEX/u);
      expect(row.plan).toMatch(/SEARCH viewer USING INDEX/u);
      expect(row.plan).not.toMatch(/SCAN/u);
      expect(row.foreignEmpty).toBe(true);
      expect(row.foreign.rowsRead).toBeLessThanOrEqual(12);
      expect(row.foreign.rowsWritten).toBe(0);
      expect(row.foreign.roundTrips).toBeLessThanOrEqual(4);
      expect(row.empty).toBe(true);
      expect(row.emptyCost.rowsRead).toBeLessThanOrEqual(12);
      expect(row.emptyCost.rowsWritten).toBe(0);
    }
    expect(results[1]!.positive.rowsRead).toBeLessThanOrEqual(
      results[0]!.positive.rowsRead + 1,
    );
  } finally {
    await fixture.close();
  }
});
