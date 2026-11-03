import { expect, it } from "vitest";
import { prioritizeCostFiles } from "./ci-test-sequencer";

it("starts costly fixtures early without dropping, duplicating or mutating discovered specifications", () => {
  const files = Object.freeze(
    [
      { moduleId: "/synthetic/scripts/new.test.ts", project: "one" },
      { moduleId: "/synthetic/scripts/purchase-details-d1-cost.test.ts" },
      { moduleId: "/synthetic/scripts/provider-agent-d1-cost.test.ts" },
      { moduleId: "/synthetic/scripts/new.test.ts", project: "two" },
      { moduleId: "/synthetic/scripts/renamed-investments-d1-cost.test.ts" },
      { moduleId: "/synthetic/scripts/new-d1-cost.test.ts" },
      { moduleId: "/synthetic/scripts/provider-agent-usage.test.ts" },
      { moduleId: "/synthetic/scripts/runtime-work-inventory.test.ts" },
      { moduleId: "/synthetic/scripts/cash-request-d1-cost.test.ts" },
      { moduleId: "/synthetic/packages/database/src/cash-accounts.test.ts" },
      {
        moduleId:
          "/synthetic/scripts/automatic-investment-review-d1-cost.test.ts",
      },
      { moduleId: "/synthetic/apps/api/src/position-purchases.test.ts" },
      {
        moduleId: "/synthetic/packages/database/src/position-purchases.test.ts",
      },
      { moduleId: "/synthetic/packages/database/src/d1-capacity.test.ts" },
      { moduleId: "/synthetic/apps/api/src/d1-capacity.test.ts" },
    ].map((file) => Object.freeze(file)),
  );
  const original = [...files];
  const ordered = prioritizeCostFiles(files);
  expect(ordered).toEqual([
    files[13],
    files[7],
    files[10],
    files[9],
    files[8],
    files[11],
    files[6],
    files[5],
    files[2],
    files[4],
    files[1],
    files[14],
    files[0],
    files[3],
    files[12],
  ]);
  expect(files).toEqual(original);
  expect(new Set(ordered)).toEqual(new Set(files));

  const repeated = Object.freeze({
    moduleId: "/synthetic/scripts/ordinary.test.ts",
    project: "repeated",
  });
  const mixed = Object.freeze([
    repeated,
    Object.freeze({ moduleId: "/synthetic/other/sql-replay.test.ts" }),
    Object.freeze({ moduleId: "/synthetic/scripts/sql-replay.test.ts" }),
    Object.freeze({ moduleId: "/synthetic/scripts/lint-typecheck.test.ts" }),
    Object.freeze({ moduleId: "/synthetic/scripts/d1-capacity-r2.test.ts" }),
    Object.freeze({ moduleId: "/synthetic/scripts/future-d1-cost.test.ts" }),
    Object.freeze({
      moduleId: "/synthetic/scripts/keel-session-check.test.ts",
    }),
    Object.freeze({
      moduleId: "/synthetic/scripts/provider-agent-usage.test.ts",
    }),
    Object.freeze({ moduleId: "/synthetic/other/d1-capacity-r2.test.ts" }),
    Object.freeze({
      moduleId: "/synthetic/scripts/ordinary.test.ts",
      project: "other",
    }),
    repeated,
  ]);
  const result = prioritizeCostFiles(mixed);
  const expected = [
    mixed[7],
    mixed[5],
    mixed[6],
    mixed[2],
    mixed[4],
    mixed[0],
    mixed[1],
    mixed[3],
    mixed[8],
    mixed[9],
    mixed[10],
  ];
  expect(result).toHaveLength(mixed.length);
  result.forEach((file, index) => expect(file).toBe(expected[index]));
  expect(result.filter((file) => file === repeated)).toHaveLength(2);
});
