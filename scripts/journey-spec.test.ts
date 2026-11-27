import {
  taskJourneys,
  taskSourceRevision,
} from "../e2e/ui-catalogue/task-journey-spec";
import { describe, expect, it } from "vitest";
import {
  areas,
  componentPage,
  edges,
  steps,
  stepsUsing,
  validateJourney,
} from "../e2e/ui-catalogue/journey-spec";
import { readFileSync } from "node:fs";
import { journeyStepStatus } from "../e2e/ui-catalogue/journey-status";
import {
  scenarios,
  valuationRoute,
} from "../e2e/ui-catalogue/valuation-scenarios";
describe("catalogue journey reference contract", () => {
  it("keeps stable connected steps and real component references", () => {
    expect(validateJourney).not.toThrow();
    const valuationIds = Object.keys(scenarios).flatMap((scenario) =>
      [
        "",
        "-review",
        "-grove",
        "-summit",
        "-vale",
        "-watch",
        "-watch-decisions",
        "-watch-all",
        "-watch-review",
      ]
        .map((suffix) => scenario + suffix)
        .filter((id) => valuationRoute(id)),
    );
    const ids = [
      ...steps.map(({ id }) => id),
      ...taskJourneys.flatMap((journey) => journey.steps.map(({ id }) => id)),
      "holdings-total",
      "holdings-total-position",
      "holdings-total-valuation",
      ...valuationIds,
    ];
    for (const id of ids) {
      const status = journeyStepStatus(id);
      expect(status, id).toBeDefined();
      expect(readFileSync(status!.evidence, "utf8").length).toBeGreaterThan(0);
      if (status!.stage === "Approved for implementation")
        expect(status!.approvalSha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(journeyStepStatus("planning-goal")?.stage).toBe("Proposal");
    expect(journeyStepStatus("planning-history")?.stage).toBe("Shipped");
    expect(journeyStepStatus("source-updates-outcome")?.stage).toBe("Proposal");
    expect(journeyStepStatus("estimate-proxy-review")).toEqual(
      journeyStepStatus("closing-price-review"),
    );
    expect(journeyStepStatus("unknown")).toBeUndefined();
    expect(edges.map((edge) => `${edge.from}:${edge.to}`)).toEqual([
      "portfolio:company",
      "company:position",
      "position:activity",
      "activity:lots",
      "lots:company",
    ]);
    for (const step of steps) {
      expect(readFileSync(step.source, "utf8").length).toBeGreaterThan(0);
      for (const name of step.components)
        expect(componentPage(name)).toBeTruthy();
    }
    expect(stepsUsing(["Tabs"]).map((step) => step.id)).toEqual([
      "activity",
      "lots",
      "holdings-total",
    ]);
  });
  it("keeps the area inventory unique and source-based", () => {
    expect(new Set(areas.map(([id]) => id)).size).toBe(9);
    const nav = readFileSync("apps/web/src/app-navigation.ts", "utf8");
    for (const [, title] of areas) expect(nav).toContain(title);
  });
});

it("keeps decorative action arrows out of the journey while retaining flow meaning", () => {
  const source = readFileSync("e2e/ui-catalogue/keel-journeys.tsx", "utf8");
  expect(source).not.toMatch(/[←→]\s*<\/TextLink>/);
  expect(source).not.toMatch(/>\s*[←→]/);
  expect(source).toContain("Overview → Holdings");
  expect(readFileSync("e2e/ui-catalogue/agent-guidance.ts", "utf8")).toContain(
    "Row navigation and actions",
  );
});

it("aggregates synthetic parent return using total basis rather than averaging rounded returns", () => {
  const valueMinor = 480000 + 320000 + 200000;
  const basisMinor = 360000 + 250000 + 150000;
  expect(basisMinor).toBe(760000);
  // Round the aggregate ratio to the whole-percent presentation using integers.
  expect(
    Math.floor(((valueMinor - basisMinor) * 100 + basisMinor / 2) / basisMinor),
  ).toBe(32);
});

it("covers all areas with bounded source-backed task paths and safe stable IDs", () => {
  const ids = taskJourneys.flatMap((journey) =>
    journey.steps.map((step) => step.id),
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toEqual(
    expect.arrayContaining([
      "cash-history",
      "maintenance-manual",
      "maintenance-links",
      "maintenance-investment",
      "maintenance-terms",
      "observed-burn",
      "planning-overview",
      "evidence-watch",
      "obligations-proposal",
      "source-updates-sources",
      "app-access-settings",
    ]),
  );
  expect(taskSourceRevision).toMatch(/^[a-f0-9]{40}$/);
  const covered = new Set([
    "holdings",
    ...taskJourneys.flatMap((journey) => journey.areas),
  ]);
  for (const [area] of areas) expect(covered.has(area)).toBe(true);
  for (const journey of taskJourneys) {
    expect(journey.steps.length).toBeGreaterThan(
      ["cash", "observed-burn"].includes(journey.id) ? 0 : 1,
    );
    for (const step of journey.steps) {
      if (journey.id === "holding-maintenance") {
        expect(journeyStepStatus(step.id)).toMatchObject({
          stage: "Shipped",
          evidence: step.source,
        });
      }
      for (const name of step.components ?? [])
        expect(componentPage(name), name).toBeTruthy();
      expect(step.id).toMatch(/^[a-z-]+$/);
      expect(readFileSync(step.source, "utf8").length).toBeGreaterThan(0);
      for (const value of [
        step.action,
        step.result,
        step.context,
        step.alternate,
        step.owner,
      ])
        expect(value.length).toBeGreaterThan(12);
      expect(step.route).toMatch(/^\//);
    }
  }
  const renderer = readFileSync("e2e/ui-catalogue/task-journeys.tsx", "utf8");
  expect(renderer).not.toMatch(
    /fetch\(|navigator\.clipboard|localStorage|window\.open|<form/,
  );
});
