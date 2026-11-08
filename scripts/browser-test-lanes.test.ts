import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BROWSER_TEST_VITE_READINESS_PATH } from "./browser-test-readiness";
import {
  BROWSER_TEST_EXECUTION,
  BROWSER_TEST_LANES,
  BROWSER_TEST_SCHEDULE,
  browserServerFailureExitCode,
  discoverBrowserSpecFiles,
  resolveBrowserTestLane,
  resolveScreenshotMode,
  validateBrowserTestLanes,
  validateProductionBrowserBuild,
} from "./browser-test-lanes";

const assigned = Object.values(BROWSER_TEST_LANES).flat();

describe("browser test lanes", () => {
  it("defaults local runs to functional and CI to canonical screenshots", () => {
    expect(
      resolveScreenshotMode({
        ci: false,
        platform: "darwin",
        architecture: "arm64",
        args: ["test", "--update-snapshots=none"],
      }),
    ).toBe("functional");
    expect(
      resolveScreenshotMode({
        ci: false,
        platform: "linux",
        architecture: "arm64",
      }),
    ).toBe("functional");
    expect(
      resolveScreenshotMode({
        ci: true,
        platform: "linux",
        architecture: "x64",
      }),
    ).toBe("canonical");
  });

  it("validates explicit screenshot modes and rejects functional CI", () => {
    const renderer = {
      ci: false,
      platform: "linux",
      architecture: "x64",
    } as const;
    expect(resolveScreenshotMode({ ...renderer, mode: "canonical" })).toBe(
      "canonical",
    );
    expect(resolveScreenshotMode({ ...renderer, mode: "functional" })).toBe(
      "functional",
    );
    for (const mode of ["", "Canonical", "pixels"])
      expect(() => resolveScreenshotMode({ ...renderer, mode })).toThrow(
        /KEEL_SCREENSHOT_MODE must be/u,
      );
    expect(() =>
      resolveScreenshotMode({ ...renderer, ci: true, mode: "functional" }),
    ).toThrow(/CI requires/u);
  });

  it("rejects a CLI override that disables canonical snapshot checks", () => {
    for (const ci of [false, true])
      expect(() =>
        resolveScreenshotMode({
          ci,
          mode: "canonical",
          platform: "linux",
          architecture: "x64",
          args: ["test", "--ignore-snapshots"],
        }),
      ).toThrow(/Canonical screenshots cannot use --ignore-snapshots/u);
  });

  it("rejects canonical screenshots outside Linux x64", () => {
    for (const renderer of [
      { platform: "linux", architecture: "arm64" },
      { platform: "linux", architecture: "arm" },
      { platform: "darwin", architecture: "arm64" },
      { platform: "darwin", architecture: "x64" },
      { platform: "win32", architecture: "x64" },
    ] as const)
      expect(() =>
        resolveScreenshotMode({ ...renderer, ci: false, mode: "canonical" }),
      ).toThrow(/Canonical screenshots require Linux x64/u);
    expect(() =>
      resolveScreenshotMode({
        platform: "linux",
        architecture: "arm64",
        ci: true,
      }),
    ).toThrow(/Canonical screenshots require Linux x64/u);
  });

  it("requires explicit canonical mode for baseline update flags", () => {
    const renderer = {
      ci: false,
      platform: "linux",
      architecture: "x64",
    } as const;
    for (const flag of [
      "-u",
      "-uall",
      "-uchanged",
      "-umissing",
      "-unone",
      "--update-snapshots",
      "--update-snapshots=all",
      "--update-snapshots=changed",
      "--update-snapshots=missing",
    ])
      expect(() =>
        resolveScreenshotMode({ ...renderer, args: ["test", flag] }),
      ).toThrow(/Snapshot updates require KEEL_SCREENSHOT_MODE=canonical/u);
    expect(
      resolveScreenshotMode({
        ...renderer,
        mode: "canonical",
        args: ["--update-snapshots=all"],
      }),
    ).toBe("canonical");
    expect(
      resolveScreenshotMode({
        ...renderer,
        args: ["test", "--grep", "snapshots"],
      }),
    ).toBe("functional");
  });

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
        "mocked-development": BROWSER_TEST_LANES["mocked-development"],
        "stateful-development": BROWSER_TEST_LANES["stateful-development"],
        "stateful-a": [
          ...BROWSER_TEST_LANES["stateful-a"],
          BROWSER_TEST_LANES.mocked[0],
        ],
        "stateful-b": BROWSER_TEST_LANES["stateful-b"],
      }),
    ).toThrow(/Assigned more than once/u);
    expect(() =>
      validateBrowserTestLanes(assigned, {
        mocked: BROWSER_TEST_LANES.mocked,
        "mocked-development": BROWSER_TEST_LANES["mocked-development"],
        "stateful-development": BROWSER_TEST_LANES[
          "stateful-development"
        ].filter((file) => file !== "portfolio-watch.visual.spec.ts"),
        "stateful-a": BROWSER_TEST_LANES["stateful-a"],
        "stateful-b": [
          ...BROWSER_TEST_LANES["stateful-b"],
          "portfolio-watch.visual.spec.ts",
        ],
      }),
    ).toThrow(/Development-only stateful specs.*portfolio-watch/u);
  });

  it("rejects unknown lane names", () => {
    expect(() =>
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "fast" }),
    ).toThrow(/KEEL_BROWSER_LANE must be one of/u);
  });

  it("bounds workers while keeping each stateful shard serialized", () => {
    expect(BROWSER_TEST_VITE_READINESS_PATH).toBe("/__keel_browser_test_ready");
    expect(
      Object.entries(BROWSER_TEST_SCHEDULE).filter(
        ([, dependencies]) => dependencies.length === 0,
      ),
    ).toHaveLength(4);
    expect(
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "mocked" }),
    ).toMatchObject({
      frontend: "production",
      lane: "mocked",
      server: "mocked",
      workers: 1,
    });
    expect(
      resolveBrowserTestLane({
        e2eDirectory: "e2e",
        lane: "mocked-development",
      }),
    ).toMatchObject({
      frontend: "production",
      lane: "mocked-development",
      server: "mocked",
      workers: 1,
    });
    expect(
      resolveBrowserTestLane({
        e2eDirectory: "e2e",
        lane: "stateful-development",
      }),
    ).toMatchObject({
      frontend: "development",
      lane: "stateful-development",
      server: "stateful",
      workers: 1,
    });
    for (const lane of [
      "stateful-a",
      "stateful-b",
      "stateful-source",
    ] as const) {
      expect(
        resolveBrowserTestLane({ e2eDirectory: "e2e", lane }),
      ).toMatchObject({
        frontend: "production",
        lane,
        server: "stateful",
        workers: 1,
      });
    }
    expect(
      resolveBrowserTestLane({ e2eDirectory: "e2e", lane: "all" }),
    ).toMatchObject({
      frontend: "development",
      lane: "all",
      server: "stateful",
      workers: 1,
    });
    expect([null, 0, 1, 2].map(browserServerFailureExitCode)).toEqual([
      1, 1, 1, 2,
    ]);
    expect(BROWSER_TEST_SCHEDULE["mocked-development"]).toEqual([
      "stateful-development",
    ]);
    expect(BROWSER_TEST_SCHEDULE["stateful-source"]).toEqual(["mocked"]);
    expect(
      Object.entries(BROWSER_TEST_SCHEDULE)
        .filter(([, dependencies]) => dependencies.length === 0)
        .reduce(
          (workers, [lane]) =>
            workers +
            BROWSER_TEST_EXECUTION[lane as keyof typeof BROWSER_TEST_EXECUTION]
              .workers,
          0,
        ),
    ).toBe(4);
    expect(BROWSER_TEST_EXECUTION["mocked-development"].workers).toBe(1);

    const root = mkdtempSync(path.join(tmpdir(), "keel-browser-build-"));
    const dist = path.join(root, "dist");
    try {
      expect(() => validateProductionBrowserBuild(root)).toThrow(
        /requires a built web dist/u,
      );
      mkdirSync(path.join(dist, "assets"), { recursive: true });
      writeFileSync(
        path.join(dist, "index.html"),
        '<link href="/assets/app.css"><script src="/assets/app.js"></script>',
      );
      writeFileSync(path.join(dist, "assets/app.css"), "body{}\n");
      expect(() => validateProductionBrowserBuild(root)).toThrow(
        /requires complete built JS and CSS assets/u,
      );
      writeFileSync(path.join(dist, "assets/app.js"), "export {};\n");
      expect(() => validateProductionBrowserBuild(root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("gives concurrent lanes distinct non-ephemeral runtime ports", () => {
    const ports = Object.values(BROWSER_TEST_EXECUTION).flatMap((lane) =>
      lane.apiPort === null ? [lane.webPort] : [lane.webPort, lane.apiPort],
    );
    expect(new Set(ports).size).toBe(ports.length);
    expect(ports.every((port) => port >= 31_000 && port < 32_768)).toBe(true);
  });
});
