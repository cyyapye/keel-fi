import { describe, expect, it } from "vitest";
import {
  BROWSER_TEST_EXECUTION,
  BROWSER_TEST_LANES,
  browserServerFailureExitCode,
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
        "stateful-a": [
          ...BROWSER_TEST_LANES["stateful-a"],
          BROWSER_TEST_LANES.mocked[0],
        ],
        "stateful-b": BROWSER_TEST_LANES["stateful-b"],
      }),
    ).toThrow(/Assigned more than once/u);
  });

  it("rejects unknown lane names", () => {
    expect(() =>
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "fast" }),
    ).toThrow(/KEEL_BROWSER_LANE must be one of/u);
  });

  it("bounds workers while keeping each stateful shard serialized", () => {
    expect(
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "mocked" }),
    ).toMatchObject({ lane: "mocked", server: "mocked", workers: 2 });
    for (const lane of ["stateful-a", "stateful-b"] as const) {
      expect(
        resolveBrowserTestLane({ e2eDirectory: "e2e", lane }),
      ).toMatchObject({ lane, server: "stateful", workers: 1 });
    }
    expect(
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "all" }),
    ).toMatchObject({ lane: "all", server: "stateful", workers: 1 });
    expect([null, 0, 1, 2].map(browserServerFailureExitCode)).toEqual([
      1, 1, 1, 2,
    ]);
  });

  it("gives concurrent lanes distinct non-ephemeral runtime ports", () => {
    const ports = Object.values(BROWSER_TEST_EXECUTION).flatMap((lane) =>
      lane.apiPort === null ? [lane.webPort] : [lane.webPort, lane.apiPort],
    );
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports.every((port) => port >= 31_000 && port < 32_768)).toBe(true);
  });
});
