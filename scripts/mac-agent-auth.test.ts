import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { MacAgentAuthorization } from "../packages/domain/src/index";
import {
  MacAgentAccessError,
  linuxAgentAuthorizationPath,
  macAgentApi,
  readMacAgentAuthorization,
  storeMacAgentAuthorization,
  type RunSecurity,
} from "./mac-agent-auth";

const authorization: MacAgentAuthorization = {
  version: 1,
  target: "tokenfolio",
  apiOrigin: "https://keel-preview-agents.example.com",
  token: `keel_agent_v1_${"a".repeat(43)}`,
};

describe("Mac agent authorization", () => {
  it("writes and verifies the credential without an interactive prompt", () => {
    const execute = vi
      .fn<RunSecurity>()
      .mockReturnValueOnce({ status: 0, stdout: "" })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify(authorization),
      });

    storeMacAgentAuthorization(
      new URL("https://keel-preview.example.com"),
      authorization,
      { executeSecurity: execute, platform: "darwin" },
    );

    const [arguments_, input] = execute.mock.calls[0] ?? [];
    expect(arguments_).toEqual(["-q", "-i"]);
    expect(input).toContain("add-generic-password");
    expect(input).toContain("-X");
    expect(input).not.toContain(" -w");
    expect(JSON.stringify(arguments_)).not.toContain(authorization.token);
    expect(input).not.toContain(authorization.token);
    expect(execute.mock.calls[1]?.[0]).toContain("find-generic-password");
  });

  it("fails closed when Keychain does not return the stored credential", () => {
    const execute = vi
      .fn<RunSecurity>()
      .mockReturnValueOnce({ status: 0, stdout: "" })
      .mockReturnValueOnce({ status: 1, stdout: "" });

    expect(() =>
      storeMacAgentAuthorization(
        new URL("https://keel-preview.example.com"),
        authorization,
        { executeSecurity: execute, platform: "darwin" },
      ),
    ).toThrow(MacAgentAccessError);
  });

  it("validates the target when reading from Keychain", () => {
    const execute = vi.fn<RunSecurity>().mockReturnValue({
      status: 0,
      stdout: JSON.stringify(authorization),
    });

    expect(
      readMacAgentAuthorization(
        new URL("https://keel-preview.example.com"),
        "tokenfolio",
        { executeSecurity: execute, platform: "darwin" },
      ),
    ).toEqual(authorization);
    expect(() =>
      readMacAgentAuthorization(
        new URL("https://keel-preview.example.com"),
        "sydecar",
        { executeSecurity: execute, platform: "darwin" },
      ),
    ).toThrow(MacAgentAccessError);
  });

  it("stores a Linux credential in a private origin-scoped file", async () => {
    const homeDirectory = await mkdtemp(
      path.join(os.tmpdir(), "keel-agent-auth-"),
    );
    const options = {
      environment: {} satisfies NodeJS.ProcessEnv,
      homeDirectory,
      platform: "linux" as const,
      uid: process.getuid?.() ?? 1_001,
    };
    try {
      storeMacAgentAuthorization(
        new URL("https://keel-preview.example.com"),
        authorization,
        options,
      );
      const file = linuxAgentAuthorizationPath(
        new URL("https://keel-preview.example.com"),
        "tokenfolio",
        options,
      );
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await readFile(file, "utf8")).not.toContain("synthetic holdings");
      expect(
        readMacAgentAuthorization(
          new URL("https://keel-preview.example.com"),
          "tokenfolio",
          options,
        ),
      ).toEqual(authorization);
    } finally {
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it("rejects a Linux credential readable by another user", async () => {
    const homeDirectory = await mkdtemp(
      path.join(os.tmpdir(), "keel-agent-auth-"),
    );
    const keelOrigin = new URL("https://keel-preview.example.com");
    const options = {
      environment: {} satisfies NodeJS.ProcessEnv,
      homeDirectory,
      platform: "linux" as const,
      uid: process.getuid?.() ?? 1_001,
    };
    try {
      storeMacAgentAuthorization(keelOrigin, authorization, options);
      const file = linuxAgentAuthorizationPath(
        keelOrigin,
        "tokenfolio",
        options,
      );
      await chmod(file, 0o644);
      expect(() =>
        readMacAgentAuthorization(keelOrigin, "tokenfolio", options),
      ).toThrow(MacAgentAccessError);
    } finally {
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it("sends the bearer only to the authorized API origin", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ version: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      macAgentApi(
        authorization,
        "/api/automation/provider-holdings/tokenfolio/mac-agent/lease",
        { method: "POST" },
        fetchImplementation,
      ),
    ).resolves.toEqual({ body: { version: 1 }, status: 200 });
    const [url, request] = fetchImplementation.mock.calls[0] ?? [];
    if (url === undefined) {
      throw new Error("Expected a Mac agent API request.");
    }
    expect(
      url instanceof URL ? url.href : url instanceof Request ? url.url : url,
    ).toBe(
      "https://keel-preview-agents.example.com/api/automation/provider-holdings/tokenfolio/mac-agent/lease",
    );
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      `Bearer ${authorization.token}`,
    );
  });

  it("turns a rejected token into a bounded repair signal", async () => {
    await expect(
      macAgentApi(
        authorization,
        "/api/automation/provider-holdings/tokenfolio/mac-agent/lease",
        { method: "POST" },
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response(null, { status: 401 })),
      ),
    ).rejects.toThrow(MacAgentAccessError);
  });
});
