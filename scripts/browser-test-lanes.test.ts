import { describe, expect, it } from "vitest";
import {
  BROWSER_TEST_LANES,
  discoverBrowserSpecFiles,
  resolveBrowserTestLane,
  validateBrowserTestLanes,
} from "./browser-test-lanes";

const assigned = Object.values(BROWSER_TEST_LANES).flat();

describe("browser test lanes", () => {
  it("keeps every repository browser spec assigned exactly once", () => {
    const actual = discoverBrowserSpecFiles("e2e");
    expect(() => validateBrowserTestLanes(actual)).not.toThrow();
  });

  it("fails closed for unassigned, duplicate and stale specs", () => {
    expect(() =>
      validateBrowserTestLanes([...assigned, "new-flow.visual.spec.ts"]),
    ).toThrow(/Unassigned specs: new-flow\.visual\.spec\.ts/u);
    expect(() => validateBrowserTestLanes(assigned.slice(1))).toThrow(
      /Missing specs/u,
    );
    expect(() =>
      validateBrowserTestLanes(assigned, {
        mocked: BROWSER_TEST_LANES.mocked,
        stateful: [
          ...BROWSER_TEST_LANES.stateful,
          BROWSER_TEST_LANES.mocked[0],
        ],
      }),
    ).toThrow(/Assigned more than once/u);
  });

  it("rejects unknown lane names", () => {
    expect(() =>
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "fast" }),
    ).toThrow(/KEEL_BROWSER_LANE must be one of/u);
  });

  it("uses two workers only for the audited mocked lane", () => {
    expect(
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "mocked" }),
    ).toMatchObject({ lane: "mocked", workers: 2 });
    expect(
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "stateful" }),
    ).toMatchObject({ lane: "stateful", workers: 1 });
    expect(
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "all" }),
    ).toMatchObject({ lane: "all", workers: 1 });
  });
});
