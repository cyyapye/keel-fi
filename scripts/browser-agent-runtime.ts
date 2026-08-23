import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { MacAgentTarget } from "../packages/domain/src/index";

export type SupportedAgentPlatform = "darwin" | "linux";

type RuntimeLocationOptions = {
  environment?: NodeJS.ProcessEnv;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
};

type CommandResult = {
  status: number | null;
  stderr: string;
  stdout: string;
};

export type RunAgentCommand = (
  command: string,
  arguments_: readonly string[],
) => CommandResult;

const runAgentCommand: RunAgentCommand = (command, arguments_) => {
  const result = spawnSync(command, [...arguments_], { encoding: "utf8" });
  return {
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
};

function supportedPlatform(
  platform: NodeJS.Platform = process.platform,
): SupportedAgentPlatform {
  if (platform === "darwin" || platform === "linux") {
    return platform;
  }
  throw new Error("Keel portfolio agents support macOS and Linux only.");
}

function absoluteXdgDirectory(
  rawDirectory: string | undefined,
  fallback: string,
): string {
  if (rawDirectory === undefined || rawDirectory.trim().length === 0) {
    return fallback;
  }
  if (!path.isAbsolute(rawDirectory)) {
    throw new Error("Linux agent directories must use absolute XDG paths.");
  }
  return rawDirectory;
}

export function agentStateRoot(options: RuntimeLocationOptions = {}): string {
  const platform = supportedPlatform(options.platform);
  const homeDirectory = options.homeDirectory ?? os.homedir();
  if (platform === "darwin") {
    return path.join(homeDirectory, "Library", "Application Support", "Keel");
  }
  const environment = options.environment ?? process.env;
  return path.join(
    absoluteXdgDirectory(
      environment.XDG_STATE_HOME,
      path.join(homeDirectory, ".local", "state"),
    ),
    "keel",
  );
}

export function agentLogDirectory(
  options: RuntimeLocationOptions = {},
): string {
  const platform = supportedPlatform(options.platform);
  const homeDirectory = options.homeDirectory ?? os.homedir();
  return platform === "darwin"
    ? path.join(homeDirectory, "Library", "Logs", "Keel")
    : path.join(agentStateRoot(options), "logs");
}

export function agentSystemdUserDirectory(
  options: RuntimeLocationOptions = {},
): string {
  if (supportedPlatform(options.platform) !== "linux") {
    throw new Error("systemd user services are available on Linux only.");
  }
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const environment = options.environment ?? process.env;
  return path.join(
    absoluteXdgDirectory(
      environment.XDG_CONFIG_HOME,
      path.join(homeDirectory, ".config"),
    ),
    "systemd",
    "user",
  );
}

export function agentApplicationDirectory(
  agentName: string,
  options: RuntimeLocationOptions = {},
): string {
  const platform = supportedPlatform(options.platform);
  if (platform === "darwin") {
    return path.join(agentStateRoot(options), agentName);
  }
  return path.join(
    agentStateRoot(options),
    "portfolio-agents",
    agentName.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "-"),
  );
}

async function fileExists(file: string): Promise<boolean> {
  return stat(file)
    .then((metadata) => metadata.isFile())
    .catch(() => false);
}

export async function chromeExecutable(
  options: RuntimeLocationOptions = {},
  exists: (file: string) => Promise<boolean> = fileExists,
): Promise<string> {
  const platform = supportedPlatform(options.platform);
  const environment = options.environment ?? process.env;
  const configured = environment.KEEL_CHROME_PATH?.trim();
  const candidates = [
    ...(configured === undefined || configured.length === 0
      ? []
      : [configured]),
    ...(platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : [
          "/usr/bin/google-chrome-stable",
          "/usr/bin/google-chrome",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
        ]),
  ];
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && (await exists(candidate))) {
      return candidate;
    }
  }
  throw new Error(
    platform === "darwin"
      ? "Google Chrome is required in /Applications."
      : "Google Chrome or Chromium is required. Set KEEL_CHROME_PATH if it is installed outside /usr/bin.",
  );
}

export function controlledChromeArguments(
  profileDirectory: string,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const supported = supportedPlatform(platform);
  return [
    `--user-data-dir=${profileDirectory}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    ...(supported === "linux"
      ? ["--headless=new", "--disable-dev-shm-usage"]
      : []),
  ];
}

export function validateInteractiveSetupEnvironment(
  options: RuntimeLocationOptions & { uid?: number } = {},
): void {
  if (supportedPlatform(options.platform) !== "linux") {
    return;
  }
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined || uid === 0) {
    throw new Error(
      "Run the Linux portfolio agent as a dedicated non-root user.",
    );
  }
  const environment = options.environment ?? process.env;
  if (
    environment.DISPLAY?.trim().length === 0 ||
    environment.DISPLAY === undefined
  ) {
    throw new Error(
      "Linux setup needs the private desktop session. Rerun the copied provider-agent-setup command from an SSH terminal.",
    );
  }
}

export function validateLinuxSystemdUser(
  execute: RunAgentCommand = runAgentCommand,
  options: { uid?: number; userName?: string } = {},
): void {
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined || uid === 0) {
    throw new Error(
      "Run the Linux portfolio agent as a dedicated non-root user.",
    );
  }
  const userName = options.userName ?? os.userInfo().username;
  const lingering = execute("loginctl", [
    "show-user",
    uid.toString(),
    "--property=Linger",
    "--value",
  ]);
  if (lingering.status !== 0 || lingering.stdout.trim() !== "yes") {
    throw new Error(
      `Enable the agent after logout with: sudo loginctl enable-linger ${userName}`,
    );
  }
  const manager = execute("systemctl", ["--user", "show-environment"]);
  if (manager.status !== 0) {
    throw new Error(
      manager.stderr.trim() ||
        "The systemd user manager is unavailable. Reconnect over SSH after enabling linger.",
    );
  }
}

function systemdQuote(value: string): string {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      throw new Error("systemd arguments cannot contain control characters.");
    }
  }
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("%", "%%")}"`;
}

export function systemdAgentUnitName(
  target: MacAgentTarget,
  instanceId: string,
): string {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(instanceId)) {
    throw new Error("The agent instance id is invalid.");
  }
  return `keel-${target}-agent-${instanceId}.service`;
}

export type SystemdAgentServiceOptions = {
  appDirectory: string;
  chromePath?: string;
  instanceId: string;
  keelOrigin: URL;
  label: string;
  nodeExecutable: string;
  providerArgument?: "tokenfolio" | "sydecar";
  repositoryRoot: string;
  scriptPath: string;
  target: MacAgentTarget;
  tsxCli: string;
  xdgConfigHome?: string;
  xdgStateHome?: string;
};

export function buildSystemdAgentService(
  options: SystemdAgentServiceOptions,
): string {
  const arguments_ = [
    options.nodeExecutable,
    options.tsxCli,
    options.scriptPath,
    "serve",
    ...(options.providerArgument === undefined
      ? []
      : ["--provider", options.providerArgument]),
    "--keel-url",
    options.keelOrigin.origin,
  ];
  const executablePath = [
    path.dirname(options.nodeExecutable),
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
  ].join(path.delimiter);
  const environment = [
    `PATH=${executablePath}`,
    ...(options.chromePath === undefined
      ? []
      : [`KEEL_CHROME_PATH=${options.chromePath}`]),
    ...(options.xdgConfigHome === undefined
      ? []
      : [`XDG_CONFIG_HOME=${options.xdgConfigHome}`]),
    ...(options.xdgStateHome === undefined
      ? []
      : [`XDG_STATE_HOME=${options.xdgStateHome}`]),
  ];
  for (const setting of environment.slice(1)) {
    const separator = setting.indexOf("=");
    if (!path.isAbsolute(setting.slice(separator + 1))) {
      throw new Error("Linux agent environment paths must be absolute.");
    }
  }
  const environmentLines = environment
    .map((setting) => `Environment=${systemdQuote(setting)}`)
    .join("\n");
  return `[Unit]
Description=${systemdQuote(`Keel ${options.label} portfolio agent for ${options.keelOrigin.origin}`)}
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=1h
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${systemdQuote(options.repositoryRoot)}
${environmentLines}
ExecStart=${arguments_.map(systemdQuote).join(" ")}
Restart=always
RestartSec=5min
TimeoutStopSec=30s
UMask=0077
PrivateTmp=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=${systemdQuote(options.appDirectory)}

[Install]
WantedBy=default.target
`;
}

export async function installSystemdAgentService(
  options: SystemdAgentServiceOptions & RuntimeLocationOptions,
  execute: RunAgentCommand = runAgentCommand,
): Promise<string> {
  if (supportedPlatform(options.platform) !== "linux") {
    throw new Error("The systemd installer supports Linux only.");
  }
  validateLinuxSystemdUser(execute);

  const unitName = systemdAgentUnitName(options.target, options.instanceId);
  const unitDirectory = agentSystemdUserDirectory(options);
  const unitPath = path.join(unitDirectory, unitName);
  const temporaryUnitPath = `${unitPath}.${process.pid.toString()}.${randomUUID()}.tmp`;
  await mkdir(unitDirectory, { mode: 0o700, recursive: true });
  await chmod(unitDirectory, 0o700);
  await mkdir(options.appDirectory, { mode: 0o700, recursive: true });
  await chmod(options.appDirectory, 0o700);
  try {
    await writeFile(temporaryUnitPath, buildSystemdAgentService(options), {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryUnitPath, 0o600);
    await rename(temporaryUnitPath, unitPath);
    await chmod(unitPath, 0o600);
  } finally {
    await rm(temporaryUnitPath, { force: true }).catch(() => undefined);
  }

  const reload = execute("systemctl", ["--user", "daemon-reload"]);
  if (reload.status !== 0) {
    throw new Error(
      reload.stderr.trim() || "systemd could not reload the agent service.",
    );
  }
  const enable = execute("systemctl", ["--user", "enable", unitName]);
  if (enable.status !== 0) {
    throw new Error(
      enable.stderr.trim() || "systemd could not start the agent service.",
    );
  }
  const restart = execute("systemctl", ["--user", "restart", unitName]);
  if (restart.status !== 0) {
    throw new Error(
      restart.stderr.trim() || "systemd could not start the agent service.",
    );
  }
  const active = execute("systemctl", [
    "--user",
    "is-active",
    "--quiet",
    unitName,
  ]);
  if (active.status !== 0) {
    throw new Error(
      active.stderr.trim() ||
        "The portfolio agent service did not stay active.",
    );
  }
  return unitName;
}

export const __browserAgentRuntimeTest = {
  supportedPlatform,
  systemdQuote,
};
