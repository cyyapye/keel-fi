import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createCostFixtureDatabase } from "./test-support/cost-database";

it("bounds the complete source job graph for a daily maximum discovery, replay, and outage", async () => {
  const configuration = readFileSync("apps/api/wrangler.jsonc", "utf8");
  expect(
    [...configuration.matchAll(/"max_retries": (\d+)/gu)].map((match) =>
      Number(match[1]),
    ),
  ).toEqual([3, 3]);
  const fixture = await createCostFixtureDatabase({
    operation: "portfolio-watch",
    nextCheckAt: "2026-09-12T00:00:00.000Z",
  });
  try {
    const result = await fixture.setup({ operation: "portfolio-watch-day" });
    if (result.operation !== "portfolio-watch-day")
      throw new Error("Unexpected source-day result");
    const { discovery, replay, outage, idle, extractedEventCounts } =
      result.results;
    expect(discovery.queueMessages).toBe(40);
    expect(discovery.queueBatches).toBe(1);
    expect(extractedEventCounts).toEqual(Array.from({ length: 40 }, () => 40));
    expect(discovery.sourceRequests).toBe(40);
    expect(discovery.queueSends).toBe(0);
    expect(discovery.objectWrites).toBe(40);
    expect(discovery.rowsRead).toBeLessThanOrEqual(150_000);
    expect(discovery.rowsWritten).toBeLessThanOrEqual(50_000);
    expect(discovery.roundTrips).toBeLessThanOrEqual(800);
    expect(replay.objectWrites).toBe(0);
    expect(replay.queueSends).toBe(0);
    expect(replay.queueBatches).toBe(1);
    expect(replay.rowsWritten).toBeLessThanOrEqual(2_000);
    expect(outage.sourceRequests).toBe(160);
    expect(outage.sourceRequests * 5).toBeLessThanOrEqual(800);
    expect(outage.rowsRead).toBeLessThanOrEqual(20_000);
    expect(outage.rowsWritten).toBeLessThanOrEqual(8_000);
    expect(outage.objectWrites).toBe(0);
    expect(outage.queueSends).toBe(0);
    expect(idle.roundTrips).toBe(1);
    expect(idle.rowsRead).toBeLessThanOrEqual(10);
    expect(idle.rowsWritten).toBe(0);
    expect(idle.queueBatches).toBe(0);
    console.info(
      JSON.stringify({
        syntheticSourceBusyDay: discovery,
        syntheticSourceReplay: replay,
        syntheticSourceFailureDay: outage,
        syntheticSourceIdleDay: idle,
      }),
    );
  } finally {
    await fixture.close();
  }
}, 120_000);
