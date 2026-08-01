import { describe, expect, it } from "vitest";

import {
  assertReviewTransition,
  getDirectEvidenceApplication,
  ReviewInputSchema,
} from "./index";

describe("evidence review", () => {
  it("accepts explicit reviewer outcomes", () => {
    expect(
      ReviewInputSchema.parse({
        decision: "scenario_only",
        rationale: "Useful for upside modeling only.",
      }),
    ).toMatchObject({ decision: "scenario_only" });
  });

  it("prevents accepted evidence from being reviewed again", () => {
    expect(() => assertReviewTransition("accepted", "rejected")).toThrow(
      "cannot transition",
    );
  });

  it("only maps explicit financial claim paths to direct applications", () => {
    expect(
      getDirectEvidenceApplication("marks.usable_liquidity.value_minor"),
    ).toEqual({ target: "usable_liquidity", label: "Usable liquidity" });
    expect(
      getDirectEvidenceApplication(
        "scenario_assumptions.earliest_liquidity_year",
      ),
    ).toBeNull();
  });
});
