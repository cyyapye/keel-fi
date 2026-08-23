import { describe, expect, it } from "vitest";
import {
  PRIMARY_API_PORT,
  PRIMARY_WEB_PORT,
  resolveDevPorts,
} from "./dev-ports";

describe("resolveDevPorts", () => {
  it("preserves the documented ports in the primary checkout", () => {
    expect(
      resolveDevPorts({
        env: {},
        linkedWorktree: false,
        rootDir: "/tmp/keel-primary",
      }),
    ).toMatchObject({
      apiPort: PRIMARY_API_PORT,
      webPort: PRIMARY_WEB_PORT,
    });
  });

  it("assigns stable alternate ports to linked worktrees", () => {
    const options = {
      env: {},
      linkedWorktree: true,
      rootDir: "/tmp/keel-worktree-a",
    } as const;
    const first = resolveDevPorts(options);
    const second = resolveDevPorts(options);

    expect(first).toEqual(second);
    expect(first.webPort).toBeGreaterThan(PRIMARY_WEB_PORT);
    expect(first.apiPort).toBeGreaterThan(PRIMARY_API_PORT);
  });

  it("accepts explicit ports and rejects invalid pairs", () => {
    expect(
      resolveDevPorts({
        env: { KEEL_API_PORT: "8900", KEEL_WEB_PORT: "4300" },
        linkedWorktree: true,
        rootDir: "/tmp/keel-worktree-b",
      }),
    ).toMatchObject({ apiPort: 8900, webPort: 4300 });

    expect(() =>
      resolveDevPorts({
        env: { KEEL_API_PORT: "4300", KEEL_WEB_PORT: "4300" },
      }),
    ).toThrow(/must be different/);
  });

  it("isolates browser-test ports from a running development server", () => {
    const rootDir = "/tmp/keel-worktree-e2e";
    const development = resolveDevPorts({
      env: {},
      linkedWorktree: true,
      rootDir,
    });
    const browserTests = resolveDevPorts({
      env: { KEEL_E2E_ISOLATED: "1" },
      linkedWorktree: true,
      rootDir,
    });

    expect(browserTests.webPort).not.toBe(development.webPort);
    expect(browserTests.apiPort).not.toBe(development.apiPort);
    expect(browserTests.webPort).toBeLessThan(45_000);
    expect(browserTests.apiPort).toBeLessThan(60_000);
  });
});
