import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { MacAgentAuthorization } from "../packages/domain/src/index";
import {
  MacAgentAccessError,
  linuxAgentAuthorizationDirectory,
  linuxAgentAuthorizationPath,
  linuxAgentLegacyAuthorizationPath,
  linuxAgentSiblingAuthorizationDirectories,
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

  it("stores a Linux credential in a private provider-scoped directory", async () => {
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
      expect(file).toMatch(
        /agent-credentials\/https-keel-preview-example-com-[a-f0-9]{16}\/tokenfolio\/authorization\.json$/u,
      );
      expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
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

  it("derives only the two sibling credential directories for isolation", () => {
    const keelOrigin = new URL("https://keel-preview.example.com");
    const options = {
      environment: {} satisfies NodeJS.ProcessEnv,
      homeDirectory: "/home/keel-agent",
    };

    expect(
      linuxAgentSiblingAuthorizationDirectories(keelOrigin, "sydecar", options),
    ).toEqual([
      linuxAgentAuthorizationDirectory(keelOrigin, "angellist", options),
      linuxAgentAuthorizationDirectory(keelOrigin, "tokenfolio", options),
    ]);
  });

  it("reads the secure legacy Linux file without mutating storage", async () => {
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
    const legacyFile = linuxAgentLegacyAuthorizationPath(
      keelOrigin,
      "tokenfolio",
      options,
    );
    const rootDirectory = path.dirname(legacyFile);
    try {
      await mkdir(rootDirectory, { mode: 0o700, recursive: true });
      await writeFile(legacyFile, `${JSON.stringify(authorization)}\n`, {
        mode: 0o600,
      });
      await chmod(rootDirectory, 0o500);

      expect(
        readMacAgentAuthorization(keelOrigin, "tokenfolio", options),
      ).toEqual(authorization);
      expect((await stat(rootDirectory)).mode & 0o777).toBe(0o500);
      await expect(
        stat(linuxAgentAuthorizationPath(keelOrigin, "tokenfolio", options)),
      ).rejects.toThrow(/ENOENT/u);
    } finally {
      await chmod(rootDirectory, 0o700).catch(() => undefined);
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it("migrates a legacy Linux credential when storing a replacement", async () => {
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
    const legacyFile = linuxAgentLegacyAuthorizationPath(
      keelOrigin,
      "tokenfolio",
      options,
    );
    try {
      await mkdir(path.dirname(legacyFile), { mode: 0o700, recursive: true });
      await writeFile(legacyFile, `${JSON.stringify(authorization)}\n`, {
        mode: 0o600,
      });

      storeMacAgentAuthorization(keelOrigin, authorization, options);

      await expect(stat(legacyFile)).rejects.toThrow(/ENOENT/u);
      expect(
        readMacAgentAuthorization(keelOrigin, "tokenfolio", options),
      ).toEqual(authorization);
    } finally {
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it("rotates inside the provider directory without changing its read-only parent", async () => {
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
    const legacyFile = linuxAgentLegacyAuthorizationPath(
      keelOrigin,
      "tokenfolio",
      options,
    );
    const rootDirectory = path.dirname(legacyFile);
    const replacement = {
      ...authorization,
      token: `keel_agent_v1_${"b".repeat(43)}`,
    };
    try {
      storeMacAgentAuthorization(keelOrigin, authorization, options);
      await writeFile(legacyFile, `${JSON.stringify(authorization)}\n`, {
        mode: 0o600,
      });
      await chmod(rootDirectory, 0o500);

      storeMacAgentAuthorization(keelOrigin, replacement, options);

      expect((await stat(rootDirectory)).mode & 0o777).toBe(0o500);
      expect(
        readMacAgentAuthorization(keelOrigin, "tokenfolio", options),
      ).toEqual(replacement);
      await expect(stat(legacyFile)).resolves.toBeDefined();
    } finally {
      await chmod(rootDirectory, 0o700).catch(() => undefined);
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it("does not fall back to legacy storage when the provider file is insecure", async () => {
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
    const legacyFile = linuxAgentLegacyAuthorizationPath(
      keelOrigin,
      "tokenfolio",
      options,
    );
    const providerFile = linuxAgentAuthorizationPath(
      keelOrigin,
      "tokenfolio",
      options,
    );
    try {
      await mkdir(path.dirname(legacyFile), { mode: 0o700, recursive: true });
      await writeFile(legacyFile, `${JSON.stringify(authorization)}\n`, {
        mode: 0o600,
      });
      await mkdir(path.dirname(providerFile), {
        mode: 0o700,
        recursive: true,
      });
      await writeFile(providerFile, `${JSON.stringify(authorization)}\n`, {
        mode: 0o644,
      });

      expect(() =>
        readMacAgentAuthorization(keelOrigin, "tokenfolio", options),
      ).toThrow(MacAgentAccessError);
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

  it("reads a Linux credential without mutating its secure directory", async () => {
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
    const file = linuxAgentAuthorizationPath(keelOrigin, "tokenfolio", options);
    const directory = path.dirname(file);
    try {
      storeMacAgentAuthorization(keelOrigin, authorization, options);
      await chmod(directory, 0o500);

      expect(
        readMacAgentAuthorization(keelOrigin, "tokenfolio", options),
      ).toEqual(authorization);
      expect((await stat(directory)).mode & 0o777).toBe(0o500);
    } finally {
      await chmod(directory, 0o700).catch(() => undefined);
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
