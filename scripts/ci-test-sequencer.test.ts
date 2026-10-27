import { expect, it } from "vitest";
import { prioritizeCostFiles } from "./ci-test-sequencer";

it("starts costly fixtures early without dropping, duplicating or mutating discovered specifications", () => {
  const files = [
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
  ];
  const original = [...files];
  const ordered = prioritizeCostFiles(files);
  expect(ordered).toEqual([
    files[10],
    files[9],
    files[8],
    files[7],
    files[6],
    files[5],
    files[2],
    files[4],
    files[1],
    files[0],
    files[3],
  ]);
  expect(files).toEqual(original);
  expect(new Set(ordered)).toEqual(new Set(files));
});
