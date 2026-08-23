import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";

const INSTANCE_HASH_LENGTH = 16;
const INSTANCE_SLUG_LENGTH = 32;

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  );
}

export function macAgentInstanceId(keelOrigin: URL): string {
  const origin = new URL(keelOrigin.origin);
  if (isLoopbackHostname(origin.hostname)) {
    return "local";
  }
  const slug = `${origin.protocol.slice(0, -1)}-${origin.host}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, INSTANCE_SLUG_LENGTH);
  const digest = createHash("sha256")
    .update(origin.origin)
    .digest("hex")
    .slice(0, INSTANCE_HASH_LENGTH);
  return `${slug}-${digest}`;
}

export function launchAgentTargetsInstance(
  plist: string,
  keelOrigin: URL,
): boolean {
  const argumentMarker = "<string>--keel-url</string>";
  const markerIndex = plist.indexOf(argumentMarker);
  if (markerIndex < 0) {
    return false;
  }
  const followingArgument = /<string>([^<]+)<\/string>/u.exec(
    plist.slice(markerIndex + argumentMarker.length),
  );
  const rawOrigin = followingArgument?.[1];
  if (rawOrigin === undefined) {
    return false;
  }
  try {
    return (
      macAgentInstanceId(new URL(rawOrigin)) === macAgentInstanceId(keelOrigin)
    );
  } catch {
    return false;
  }
}

export async function retireMatchingLegacyLaunchAgent(
  domain: string,
  legacyLaunchAgentPath: string,
  keelOrigin: URL,
): Promise<void> {
  const plist = await readFile(legacyLaunchAgentPath, "utf8").catch(
    (error: unknown) => {
      if (
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    },
  );
  if (plist === null || !launchAgentTargetsInstance(plist, keelOrigin)) {
    return;
  }
  spawnSync("launchctl", ["bootout", domain, legacyLaunchAgentPath], {
    stdio: "ignore",
  });
  await rm(legacyLaunchAgentPath, { force: true });
}
