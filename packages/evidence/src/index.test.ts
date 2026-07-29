import { describe, expect, it } from "vitest";

import { assertReviewTransition, ReviewInputSchema } from "./index";

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
});
