import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  agentApplicationDirectory,
  agentStateRoot,
  buildSystemdAgentService,
  chromeExecutable,
  chromeProcessIdsForProfile,
  controlledChromeArguments,
  installSystemdAgentService,
  linuxSystemAgentLayout,
  removeStaleChromeProfileLocks,
  systemdAgentUnitName,
  validateInteractiveSetupEnvironment,
  validateLinuxSystemdUser,
  waitForProfileChromeExit,
  type RunAgentCommand,
  type SystemdAgentServiceOptions,
} from "./browser-agent-runtime";

const linuxService: SystemdAgentServiceOptions = {
  appDirectory:
    "/home/synthetic/.local/state/keel/portfolio-agents/sydecar-agent/instances/local",
  chromePath: "/opt/chrome/google-chrome",
  credentialDirectory:
    "/home/synthetic/.config/keel/agent-credentials/https-keel-preview-example-com-a55d81854a922b4e/sydecar",
  inaccessibleCredentialDirectories: [
    "/home/synthetic/.config/keel/agent-credentials/https-keel-preview-example-com-a55d81854a922b4e/angellist",
    "/home/synthetic/.config/keel/agent-credentials/https-keel-preview-example-com-a55d81854a922b4e/tokenfolio",
  ],
  instanceId: "https-keel-preview-example-com-a55d81854a922b4e",
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
const linuxAdministratorService = linuxSystemAgentLayout(
  linuxService.keelOrigin,
  linuxService.target,
);

type AdministratorServiceOverrides = Partial<{
  group: string;
  inaccessiblePaths: string;
  readWritePaths: string;
  user: string;
  workingDirectory: string;
}>;

function administratorServiceResult(
  command: string,
  arguments_: readonly string[],
  overrides: AdministratorServiceOverrides = {},
): ReturnType<RunAgentCommand> {
  if (
    command === "systemctl" &&
    arguments_[0] === "show" &&
    arguments_.includes("--property=LoadState")
  ) {
    return { status: 0, stderr: "", stdout: "loaded\n" };
  }
  if (command === "systemctl" && arguments_[0] === "is-active") {
    return { status: 0, stderr: "", stdout: "active\n" };
  }
  const properties = {
    "--property=Group": overrides.group ?? linuxAdministratorService.group,
    "--property=InaccessiblePaths":
      overrides.inaccessiblePaths ??
      linuxAdministratorService.inaccessibleHomeDirectories.join(" "),
    "--property=ReadWritePaths":
      overrides.readWritePaths ??
      `${linuxAdministratorService.appDirectory} ${linuxAdministratorService.credentialDirectory}`,
    "--property=User": overrides.user ?? linuxAdministratorService.user,
    "--property=WorkingDirectory":
      overrides.workingDirectory ?? linuxAdministratorService.repositoryRoot,
  } as const;
  for (const [property, value] of Object.entries(properties)) {
    if (
      command === "systemctl" &&
      arguments_[0] === "show" &&
      arguments_.includes(property)
    ) {
      return { status: 0, stderr: "", stdout: `${value}\n` };
    }
  }
  return { status: 1, stderr: "unexpected command", stdout: "" };
}

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

  it("assigns each administrator agent its own non-login account layout", () => {
    expect(linuxAdministratorService).toEqual({
      appDirectory:
        "/var/lib/keel-agents/sydecar/.local/state/keel/portfolio-agents/sydecar-agent/Instances/https-keel-preview-example-com-a55d81854a922b4e",
      credentialDirectory:
        "/var/lib/keel-agents/sydecar/.config/keel/agent-credentials/https-keel-preview-example-com-a55d81854a922b4e/sydecar",
      group: "keel-sydecar",
      homeDirectory: "/var/lib/keel-agents/sydecar",
      inaccessibleHomeDirectories: [
        "/var/lib/keel-agents/angellist",
        "/var/lib/keel-agents/tokenfolio",
      ],
      repositoryRoot: "/opt/keel-fi",
      user: "keel-sydecar",
      xdgConfigHome: "/var/lib/keel-agents/sydecar/.config",
      xdgStateHome: "/var/lib/keel-agents/sydecar/.local/state",
    });
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
    expect(arguments_).toContain("--disable-background-networking");
    expect(arguments_.at(-1)).toBe("about:blank");
  });

  it("prefers the Keel Linux Chrome wrapper when the host provides it", async () => {
    await expect(
      chromeExecutable({ environment: {}, platform: "linux" }, (file) =>
        Promise.resolve(
          file === "/usr/local/libexec/keel-google-chrome" ||
            file === "/usr/bin/google-chrome-stable",
        ),
      ),
    ).resolves.toBe("/usr/local/libexec/keel-google-chrome");
  });

  it("finds a Linux profile browser after its launcher resolves or rewrites argv zero", () => {
    const profile = "/home/synthetic/.local/state/keel/provider/Chrome";
    const processList = [
      `101 /usr/local/libexec/keel-google-chrome --disable-setuid-sandbox --user-data-dir=${profile}`,
      `102 /opt/google/chrome/chrome --user-data-dir=${profile} --headless=new`,
      `103 /opt/google/chrome/chrome --type=renderer --user-data-dir=${profile}`,
      `104 /usr/bin/python3 --user-data-dir=${profile}`,
      `105 /opt/google/chrome/chrome --user-data-dir=${profile}-copy`,
    ].join("\n");

    expect(
      chromeProcessIdsForProfile(
        processList,
        profile,
        "/usr/bin/google-chrome-stable",
        "linux",
      ),
    ).toEqual([101, 102]);
  });

  it("removes only stale Chrome singleton lock artifacts", async () => {
    const profile = await mkdtemp(path.join(os.tmpdir(), "keel-profile-"));
    try {
      await Promise.all([
        writeFile(path.join(profile, "SingletonCookie"), "stale"),
        writeFile(path.join(profile, "SingletonLock"), "stale"),
        writeFile(path.join(profile, "SingletonSocket"), "stale"),
        writeFile(path.join(profile, "Cookies"), "preserved"),
      ]);

      await removeStaleChromeProfileLocks(profile);

      await expect(stat(path.join(profile, "SingletonCookie"))).rejects.toThrow(
        /ENOENT/u,
      );
      await expect(stat(path.join(profile, "SingletonLock"))).rejects.toThrow(
        /ENOENT/u,
      );
      await expect(stat(path.join(profile, "SingletonSocket"))).rejects.toThrow(
        /ENOENT/u,
      );
      await expect(
        readFile(path.join(profile, "Cookies"), "utf8"),
      ).resolves.toBe("preserved");
    } finally {
      await rm(profile, { force: true, recursive: true });
    }
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

  it("allows a slow dedicated Chrome profile to finish shutting down", async () => {
    let observations = 0;
    const remainingProcessIds = vi.fn(() => {
      observations += 1;
      return observations <= 41 ? [42] : [];
    });
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      waitForProfileChromeExit(remainingProcessIds, wait),
    ).resolves.toBe(true);
    expect(wait).toHaveBeenCalledTimes(41);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it("keeps dedicated Chrome shutdown waiting bounded", async () => {
    const remainingProcessIds = vi.fn(() => [42]);
    const wait = vi.fn(() => Promise.resolve());

    await expect(
      waitForProfileChromeExit(remainingProcessIds, wait),
    ).resolves.toBe(false);
    expect(wait).toHaveBeenCalledTimes(120);
    expect(remainingProcessIds).toHaveBeenCalledTimes(121);
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

  it("does not require a login manager for a dedicated system identity", () => {
    const execute = vi.fn<RunAgentCommand>();
    expect(() =>
      validateLinuxSystemdUser(execute, {
        systemUserName: "keel-sydecar",
        uid: 1_008,
        userName: "keel-sydecar",
      }),
    ).not.toThrow();
    expect(execute).not.toHaveBeenCalled();
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
    expect(unit).toContain(`WorkingDirectory=${linuxService.repositoryRoot}`);
    expect(unit).toContain(`ReadWritePaths=${linuxService.appDirectory}`);
    expect(unit).toContain(
      `ReadWritePaths=${linuxService.credentialDirectory}`,
    );
    for (const directory of linuxService.inaccessibleCredentialDirectories) {
      expect(unit).toContain(`InaccessiblePaths=${directory}`);
    }
    expect(unit).not.toContain(
      `InaccessiblePaths=${linuxService.credentialDirectory}`,
    );
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

  it("rejects service paths that systemd would reinterpret", () => {
    expect(() =>
      buildSystemdAgentService({
        ...linuxService,
        repositoryRoot: "/srv/keel fi",
      }),
    ).toThrow("contain no whitespace");
    expect(() =>
      buildSystemdAgentService({
        ...linuxService,
        appDirectory: "/home/synthetic/%i",
      }),
    ).toThrow("systemd specifiers");
    expect(() =>
      buildSystemdAgentService({
        ...linuxService,
        credentialDirectory: "/home/synthetic/credential dir",
      }),
    ).toThrow("contain no whitespace");
    expect(() =>
      buildSystemdAgentService({
        ...linuxService,
        inaccessibleCredentialDirectories: [
          linuxService.credentialDirectory,
          "/home/synthetic/other",
        ],
      }),
    ).toThrow("hide both sibling credential directories");
  });

  it.runIf(process.platform === "linux")(
    "emits a unit accepted by the installed systemd parser",
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "keel-systemd-unit-"),
      );
      const unitPath = path.join(directory, "keel-agent-test.service");
      try {
        await writeFile(
          unitPath,
          buildSystemdAgentService({
            ...linuxService,
            appDirectory: directory,
            nodeExecutable: process.execPath,
            repositoryRoot: directory,
            scriptPath: "/bin/true",
            tsxCli: "/bin/true",
          }),
        );
        const result = spawnSync("systemd-analyze", ["verify", unitPath], {
          encoding: "utf8",
        });
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    },
  );

  it("writes and enables only the exact systemd user service", async () => {
    const homeDirectory = await mkdtemp(
      path.join(os.tmpdir(), "keel-agent-runtime-"),
    );
    const appDirectory = path.join(homeDirectory, "state", "sydecar");
    const credentialDirectory = path.join(
      homeDirectory,
      ".config",
      "keel",
      "agent-credentials",
      linuxService.instanceId,
      "sydecar",
    );
    const inaccessibleCredentialDirectories = [
      path.join(path.dirname(credentialDirectory), "angellist"),
      path.join(path.dirname(credentialDirectory), "tokenfolio"),
    ];
    const execute = vi.fn<RunAgentCommand>((command, arguments_) => {
      if (command === "systemctl" && arguments_[0] === "show") {
        return { status: 1, stderr: "not found", stdout: "not-found\n" };
      }
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
          credentialDirectory,
          inaccessibleCredentialDirectories,
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
      expect((await stat(credentialDirectory)).mode & 0o777).toBe(0o700);
      for (const directory of inaccessibleCredentialDirectories) {
        expect((await stat(directory)).mode & 0o777).toBe(0o700);
      }
      expect(await readFile(unitPath, "utf8")).toBe(
        buildSystemdAgentService({
          ...linuxService,
          appDirectory,
          credentialDirectory,
          inaccessibleCredentialDirectories,
        }),
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

  it("reuses an administrator-provisioned system service instead of creating a duplicate", async () => {
    const homeDirectory = await mkdtemp(
      path.join(os.tmpdir(), "keel-agent-runtime-"),
    );
    const execute = vi.fn<RunAgentCommand>(administratorServiceResult);
    try {
      await expect(
        installSystemdAgentService(
          {
            ...linuxService,
            environment: {},
            homeDirectory,
            platform: "linux",
          },
          execute,
        ),
      ).resolves.toBe(
        "keel-sydecar-agent-https-keel-preview-example-com-a55d81854a922b4e.service",
      );
      await expect(
        stat(path.join(homeDirectory, ".config", "systemd", "user")),
      ).rejects.toThrow(/ENOENT/u);
      expect(execute).toHaveBeenCalledTimes(7);
    } finally {
      await rm(homeDirectory, { force: true, recursive: true });
    }
  });

  it("rejects an administrator service that shares another Linux identity", async () => {
    const execute = vi.fn<RunAgentCommand>((command, arguments_) =>
      administratorServiceResult(command, arguments_, { user: "keel-agent" }),
    );

    await expect(
      installSystemdAgentService(
        { ...linuxService, platform: "linux" },
        execute,
      ),
    ).rejects.toThrow("dedicated provider user and group");
  });

  it("rejects a hardened system service that cannot persist credential rotation", async () => {
    const execute = vi.fn<RunAgentCommand>((command, arguments_) =>
      administratorServiceResult(command, arguments_, {
        readWritePaths: linuxAdministratorService.appDirectory,
      }),
    );

    await expect(
      installSystemdAgentService(
        { ...linuxService, platform: "linux" },
        execute,
      ),
    ).rejects.toThrow("private app and credential directories");
  });

  it("rejects a system service that can read a sibling agent home", async () => {
    const execute = vi.fn<RunAgentCommand>((command, arguments_) =>
      administratorServiceResult(command, arguments_, {
        inaccessiblePaths:
          linuxAdministratorService.inaccessibleHomeDirectories[0] ?? "",
      }),
    );

    await expect(
      installSystemdAgentService(
        { ...linuxService, platform: "linux" },
        execute,
      ),
    ).rejects.toThrow("hide both sibling agent homes");
  });

  it("rejects a system service that masks its own private home", async () => {
    const execute = vi.fn<RunAgentCommand>((command, arguments_) =>
      administratorServiceResult(command, arguments_, {
        inaccessiblePaths: [
          ...linuxAdministratorService.inaccessibleHomeDirectories,
          linuxAdministratorService.homeDirectory,
        ].join(" "),
      }),
    );

    await expect(
      installSystemdAgentService(
        { ...linuxService, platform: "linux" },
        execute,
      ),
    ).rejects.toThrow("without hiding its own private home");
  });
});
