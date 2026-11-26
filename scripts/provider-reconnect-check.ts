import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  MacAgentApiOriginSchema,
  MacAgentTargetSchema,
  type MacAgentTarget,
} from "../packages/domain/src/index";
import {
  linuxSystemAgentLayout,
  systemdAgentUnitName,
} from "./browser-agent-runtime";
import { readMacAgentAuthorization } from "./mac-agent-auth";
import { macAgentInstanceId } from "./mac-agent-instance";
import { loadReconnectAccess } from "./provider-reconnect-access";

const script = fileURLToPath(import.meta.url);
const positiveInteger = /^[1-9][0-9]*$/u;
const command = z.union([
  z.tuple([MacAgentApiOriginSchema]),
  z.tuple([MacAgentApiOriginSchema, MacAgentTargetSchema]),
]);

function readCommand(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function servicePid(unit: string, user: string, group: string): string | null {
  const properties = new Set(
    readCommand("/usr/bin/systemctl", [
      "show",
      "--property=ActiveState,MainPID,User,Group",
      unit,
    ]).split("\n"),
  );
  if (
    !properties.has("ActiveState=active") ||
    !properties.has(`User=${user}`) ||
    !properties.has(`Group=${group}`)
  ) {
    return null;
  }
  const pid = [...properties]
    .find((property) => property.startsWith("MainPID="))
    ?.slice("MainPID=".length);
  return pid && positiveInteger.test(pid) ? pid : null;
}

function checkSystemService(origin: URL, provider: MacAgentTarget): boolean {
  const { user, group } = linuxSystemAgentLayout(origin, provider);
  const unit = systemdAgentUnitName(provider, macAgentInstanceId(origin));
  const pid = servicePid(unit, user, group);
  if (pid === null) return false;

  const uid = readCommand("/usr/bin/id", ["-u", user]);
  const [groupName, , gid] = readCommand("/usr/bin/getent", [
    "group",
    group,
  ]).split(":");
  if (
    !positiveInteger.test(uid) ||
    groupName !== group ||
    gid === undefined ||
    !positiveInteger.test(gid)
  ) {
    return false;
  }

  // Use the active service's environment and mounts, then read private files as
  // the provider itself. Only the exit status leaves the subprocess.
  const probe = spawnSync(
    "/usr/bin/sudo",
    [
      "-n",
      "/usr/bin/nsenter",
      `--target=${pid}`,
      "--mount",
      "--net",
      "--env",
      `--setuid=${uid}`,
      `--setgid=${gid}`,
      `--wdns=${dirname(script)}`,
      "--",
      process.execPath,
      ...process.execArgv,
      script,
      origin.origin,
      provider,
    ],
    { stdio: "ignore", timeout: 10_000 },
  );
  return probe.status === 0 && servicePid(unit, user, group) === pid;
}

export async function validateProviderReconnectConfig(
  origin: URL,
  provider: MacAgentTarget,
): Promise<boolean> {
  const authorization = readMacAgentAuthorization(origin, provider, {
    platform: "linux",
  });
  await loadReconnectAccess(authorization.apiOrigin, provider);
  return true;
}

export async function checkProviderReconnectConfigs(
  origin: URL,
  check: (
    origin: URL,
    provider: MacAgentTarget,
  ) => boolean | Promise<boolean> = checkSystemService,
  report: (line: string) => void = console.log,
): Promise<number> {
  let allPassed = true;
  for (const provider of MacAgentTargetSchema.options) {
    let passed = false;
    try {
      passed = await check(origin, provider);
    } catch {
      // Errors from private file reads can contain paths or credential values.
    }
    report(`${provider}: ${passed ? "PASS" : "FAIL"}`);
    allPassed = allPassed && passed;
  }
  return allPassed ? 0 : 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === script) {
  const input = command.safeParse(process.argv.slice(2));
  if (
    !input.success ||
    process.platform !== "linux" ||
    process.getuid?.() === 0
  ) {
    console.error(
      "Run node --import tsx scripts/provider-reconnect-check.ts <Keel origin> as a non-root Linux worker operator.",
    );
    process.exitCode = 2;
  } else {
    const [origin, provider] = input.data;
    process.exitCode = await (provider === undefined
      ? checkProviderReconnectConfigs(new URL(origin))
      : validateProviderReconnectConfig(new URL(origin), provider).then(
          () => 0,
          () => 1,
        ));
  }
}
