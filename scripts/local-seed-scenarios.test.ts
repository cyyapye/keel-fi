import { describe, expect, it } from "vitest";

import {
  assertScenarioCheck,
  DEFAULT_LOCAL_SEED_SCENARIO,
  LocalSeedScenarios,
  parseLocalSeedScenario,
  resolveLocalScenarioPersistRoot,
  scenarioMarkerMatches,
} from "./local-seed-scenarios";

describe("local seed scenarios", () => {
  it("defaults to the populated synthetic profile", () => {
    expect(parseLocalSeedScenario(undefined)).toBe(DEFAULT_LOCAL_SEED_SCENARIO);
    expect(LocalSeedScenarios.default.expectedCurrentPositionCount).toBe(5);
  });

  it("accepts only registered scenario names", () => {
    expect(parseLocalSeedScenario("empty-holdings")).toBe("empty-holdings");
    expect(parseLocalSeedScenario("entity-review")).toBe("entity-review");
    expect(() => parseLocalSeedScenario("../../production")).toThrow(
      /Unknown local seed scenario/,
    );
  });

  it("keeps every scenario in an exact disposable child directory", () => {
    expect(resolveLocalScenarioPersistRoot("default", "/tmp/keel-fi")).toBe(
      "/tmp/keel-fi/.keel-local/scenarios/default",
    );
  });

  it("invalidates stale or mismatched seed markers", () => {
    expect(
      scenarioMarkerMatches({ scenario: "default", version: 2 }, "default"),
    ).toBe(true);
    expect(
      scenarioMarkerMatches({ scenario: "default", version: 1 }, "default"),
    ).toBe(false);
    expect(
      scenarioMarkerMatches(
        { scenario: "empty-holdings", version: 1 },
        "default",
      ),
    ).toBe(false);
    expect(
      scenarioMarkerMatches({ scenario: "default", version: 0 }, "default"),
    ).toBe(false);
  });

  it("checks populated and empty Holdings scenario contracts", () => {
    const common = {
      accepted_value_decreases: 1,
      accepted_value_increases: 1,
      canonical_exposures: 3,
      current_positions: 5,
      forecast_snapshots: 1,
      goal_versions_without_snapshot: 0,
      goals: 1,
      households: 1,
      primary_goals: 1,
    };
    expect(() => assertScenarioCheck("default", common)).not.toThrow();
    expect(() =>
      assertScenarioCheck("empty-holdings", {
        ...common,
        canonical_exposures: 0,
        current_positions: 0,
      }),
    ).not.toThrow();
    expect(() => assertScenarioCheck("empty-holdings", common)).toThrow(
      /failed its invariants/,
    );
    expect(() =>
      assertScenarioCheck("default", {
        ...common,
        accepted_value_decreases: 0,
      }),
    ).toThrow(/failed its invariants/);
  });
});
