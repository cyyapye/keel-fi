import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  agentApplicationDirectory,
  agentStateRoot,
  buildSystemdAgentService,
  chromeExecutable,
  controlledChromeArguments,
  installSystemdAgentService,
  systemdAgentUnitName,
  validateInteractiveSetupEnvironment,
  validateLinuxSystemdUser,
  type RunAgentCommand,
  type SystemdAgentServiceOptions,
} from "./browser-agent-runtime";

const linuxService: SystemdAgentServiceOptions = {
  appDirectory:
    "/home/synthetic/.local/state/keel/portfolio-agents/sydecar-agent/instances/local",
  chromePath: "/opt/chrome/google-chrome",
  instanceId: "https-keel-preview-example-com-0123456789abcdef",
  keelOrigin: new URL("https://keel-preview.example.com"),
  label: "Sydecar",
  nodeExecutable: "/opt/node/bin/node",
  providerArgument: "sydecar",
  repositoryRoot: "/srv/keel-fi",
  scriptPath: "/srv/keel-fi/scripts/provider-portfolio-mac-agent.ts",
  target: "sydecar",
  tsxCli: "/srv/keel-fi/node_modules/tsx/dist/cli.mjs",
  xdgConfigHome: "/home/synthetic/.config",
  xdgStateHome: "/home/synthetic/.local/state",
};

describe("portfolio agent platform runtime", () => {
  it("uses standard private state roots on macOS and Linux", () => {
    expect(
      agentStateRoot({
        homeDirectory: "/Users/synthetic",
        platform: "darwin",
      }),
    ).toBe("/Users/synthetic/Library/Application Support/Keel");
    expect(
      agentApplicationDirectory("Sydecar Agent", {
        environment: {},
        homeDirectory: "/home/synthetic",
        platform: "linux",
      }),
    ).toBe("/home/synthetic/.local/state/keel/portfolio-agents/sydecar-agent");
  });

  it("finds supported Linux Chrome installs and runs automation headlessly", async () => {
    await expect(
      chromeExecutable({ environment: {}, platform: "linux" }, (file) =>
        Promise.resolve(file === "/usr/bin/google-chrome-stable"),
      ),
    ).resolves.toBe("/usr/bin/google-chrome-stable");
    const arguments_ = controlledChromeArguments(
      "/home/synthetic/.local/state/keel/profile",
      "linux",
    );
    expect(arguments_).toContain("--headless=new");
    expect(arguments_).toContain("--disable-dev-shm-usage");
    expect(arguments_).toContain("--remote-debugging-address=127.0.0.1");
  });

  it("requires a non-root private display for interactive Linux setup", () => {
    expect(() =>
      validateInteractiveSetupEnvironment({
        environment: {},
        platform: "linux",
        uid: 1_001,
      }),
    ).toThrow("private desktop session");
    expect(() =>
      validateInteractiveSetupEnvironment({
        environment: { DISPLAY: ":99" },
        platform: "linux",
        uid: 0,
      }),
    ).toThrow("non-root");
    expect(() =>
      validateInteractiveSetupEnvironment({
        environment: { DISPLAY: ":99" },
        platform: "linux",
        uid: 1_001,
      }),
    ).not.toThrow();
  });

  it("requires user lingering before installing an always-on service", () => {
    const execute = vi.fn<RunAgentCommand>().mockReturnValue({
      status: 0,
      stderr: "",
      stdout: "no\n",
    });
    expect(() =>
      validateLinuxSystemdUser(execute, {
        uid: 1_001,
        userName: "keel-agent",
      }),
    ).toThrow("sudo loginctl enable-linger keel-agent");
  });

  it("builds an origin-scoped persistent service without a credential", () => {
    const unit = buildSystemdAgentService(linuxService);
    expect(unit).toContain(
      'ExecStart="/opt/node/bin/node" "/srv/keel-fi/node_modules/tsx/dist/cli.mjs"',
    );
    expect(unit).toContain('"serve" "--provider" "sydecar"');
    expect(unit).toContain('"--keel-url" "https://keel-preview.example.com"');
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("ProtectHome=read-only");
    expect(unit).toContain(`ReadWritePaths="${linuxService.appDirectory}"`);
    expect(unit).toContain(
      'Environment="KEEL_CHROME_PATH=/opt/chrome/google-chrome"',
    );
    expect(unit).toContain(
      'Environment="XDG_CONFIG_HOME=/home/synthetic/.config"',
    );
    expect(unit).not.toContain("Authorization");
    expect(unit).not.toContain("keel_agent_v1");
    expect(systemdAgentUnitName("sydecar", linuxService.instanceId)).toBe(
      `keel-sydecar-agent-${linuxService.instanceId}.service`,
    );
  });

  it("writes and enables only the exact systemd user service", async () => {
    const homeDirectory = await mkdtemp(
      path.join(os.tmpdir(), "keel-agent-runtime-"),
    );
    const appDirectory = path.join(homeDirectory, "state", "sydecar");
    const execute = vi.fn<RunAgentCommand>((command, arguments_) => {
      if (command === "loginctl") {
        return { status: 0, stderr: "", stdout: "yes\n" };
      }
      if (command === "systemctl" && arguments_[0] === "--user") {
        return { status: 0, stderr: "", stdout: "" };
      }
      return { status: 1, stderr: "unexpected command", stdout: "" };
    });
    try {
      const unitName = await installSystemdAgentService(
        {
          ...linuxService,
          appDirectory,
          environment: {},
          homeDirectory,
          platform: "linux",
        },
        execute,
      );
      const unitPath = path.join(
        homeDirectory,
        ".config",
        "systemd",
        "user",
        unitName,
      );
      expect((await stat(unitPath)).mode & 0o777).toBe(0o600);
      expect(await readFile(unitPath, "utf8")).toBe(
        buildSystemdAgentService({ ...linuxService, appDirectory }),
      );
      expect(execute).toHaveBeenCalledWith("systemctl", [
        "--user",
        "enable",
        unitName,
      ]);
      expect(execute).toHaveBeenCalledWith("systemctl", [
        "--user",
        "restart",
        unitName,
      ]);
      expect(execute).toHaveBeenCalledWith("systemctl", [
        "--user",
        "is-active",
        "--quiet",
        unitName,
      ]);
    } finally {
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });
});
