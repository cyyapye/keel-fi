import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = fileURLToPath(new URL("../", import.meta.url));
const KEEL_URL = "https://keel.example";

function runMake(
  target: string,
  provider?: string,
  agentPlatform: "Darwin" | "Linux" = "Darwin",
) {
  const environment = { ...process.env };
  if (agentPlatform === "Linux") {
    delete environment.DISPLAY;
  }
  return spawnSync(
    "make",
    [
      target,
      ...(provider === undefined ? [] : [`PROVIDER=${provider}`]),
      `KEEL_URL=${KEEL_URL}`,
      `AGENT_PLATFORM=${agentPlatform}`,
      "PNPM=echo",
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: environment,
    },
  );
}

describe("provider agent command interface", () => {
  it.each([
    ["provider-agent-setup", "angellist", "angellist:setup -- --keel-url"],
    ["provider-agent-run", "angellist", "angellist:run -- --keel-url"],
    [
      "provider-agent-setup",
      "tokenfolio",
      "provider:setup -- --provider tokenfolio",
    ],
    [
      "provider-agent-run",
      "tokenfolio",
      "provider:run -- --provider tokenfolio",
    ],
    ["provider-agent-setup", "sydecar", "provider:setup -- --provider sydecar"],
    ["provider-agent-run", "sydecar", "provider:run -- --provider sydecar"],
  ])("dispatches %s for %s", (target, provider, expectedCommand) => {
    const result = runMake(target, provider);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(expectedCommand);
    expect(result.stdout).toContain(KEEL_URL);
  });

  it.each(["angellist-setup", "angellist-run"])(
    "does not expose the retired %s target",
    (target) => {
      const result = runMake(target);

      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("--keel-url");
    },
  );

  it.each(["angellist", "tokenfolio", "sydecar"])(
    "starts a private setup desktop for headless Linux %s",
    (provider) => {
      const result = runMake("provider-agent-setup", provider, "Linux");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "exec tsx scripts/linux-agent-setup-session.ts",
      );
      expect(result.stdout).toContain(`--provider ${provider}`);
      expect(result.stdout).toContain(KEEL_URL);
    },
  );

  it("rejects unsupported providers before invoking an agent", () => {
    const result = runMake("provider-agent-setup", "unsupported");

    expect(result.status).toBe(2);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "PROVIDER must be angellist, tokenfolio, or sydecar.",
    );
  });
});
