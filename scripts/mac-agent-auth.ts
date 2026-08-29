import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  MacAgentAuthorizationSchema,
  type MacAgentAuthorization,
  type MacAgentTarget,
} from "../packages/domain/src/index";
import { macAgentInstanceId } from "./mac-agent-instance";

const KEYCHAIN_SERVICE = "com.keel.mac-agent";
const SECURITY_PATH = "/usr/bin/security";
const MAC_AGENT_TARGETS = ["angellist", "tokenfolio", "sydecar"] as const;

type SecurityResult = {
  status: number | null;
  stdout: string;
};

export type RunSecurity = (
  arguments_: readonly string[],
  input?: string,
) => SecurityResult;

export type AgentAuthorizationStorageOptions = {
  environment?: NodeJS.ProcessEnv;
  executeSecurity?: RunSecurity;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  uid?: number;
};

const runSecurity: RunSecurity = (arguments_, input) => {
  const result = spawnSync(SECURITY_PATH, [...arguments_], {
    encoding: "utf8",
    input,
    maxBuffer: 64 * 1_024,
  });
  return { status: result.status, stdout: result.stdout };
};

export class MacAgentAccessError extends Error {
  public constructor() {
    super("mac_access_required");
    this.name = "MacAgentAccessError";
  }
}

function linuxAuthorizationRootDirectory(
  keelOrigin: URL,
  options: AgentAuthorizationStorageOptions,
): string {
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const environment = options.environment ?? process.env;
  const rawConfigHome = environment.XDG_CONFIG_HOME?.trim();
  const configHome =
    rawConfigHome === undefined || rawConfigHome.length === 0
      ? path.join(homeDirectory, ".config")
      : rawConfigHome;
  if (!path.isAbsolute(configHome)) {
    throw new MacAgentAccessError();
  }
  return path.join(
    configHome,
    "keel",
    "agent-credentials",
    macAgentInstanceId(keelOrigin),
  );
}

export function linuxAgentAuthorizationDirectory(
  keelOrigin: URL,
  target: MacAgentTarget,
  options: AgentAuthorizationStorageOptions = {},
): string {
  return path.join(
    linuxAuthorizationRootDirectory(keelOrigin, options),
    target,
  );
}

export function linuxAgentSiblingAuthorizationDirectories(
  keelOrigin: URL,
  target: MacAgentTarget,
  options: AgentAuthorizationStorageOptions = {},
): string[] {
  return MAC_AGENT_TARGETS.filter((candidate) => candidate !== target).map(
    (candidate) =>
      linuxAgentAuthorizationDirectory(keelOrigin, candidate, options),
  );
}

export function linuxAgentAuthorizationPath(
  keelOrigin: URL,
  target: MacAgentTarget,
  options: AgentAuthorizationStorageOptions = {},
): string {
  return path.join(
    linuxAgentAuthorizationDirectory(keelOrigin, target, options),
    "authorization.json",
  );
}

export function linuxAgentLegacyAuthorizationPath(
  keelOrigin: URL,
  target: MacAgentTarget,
  options: AgentAuthorizationStorageOptions = {},
): string {
  return path.join(
    linuxAuthorizationRootDirectory(keelOrigin, options),
    `${target}.json`,
  );
}

function secureUid(options: AgentAuthorizationStorageOptions): number {
  const uid = options.uid ?? process.getuid?.();
  if (uid === undefined || uid === 0) {
    throw new MacAgentAccessError();
  }
  return uid;
}

function assertSecureDirectory(directory: string, uid: number): void {
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o077) !== 0
  ) {
    throw new MacAgentAccessError();
  }
}

function isMissingPath(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function prepareSecureDirectory(directory: string, uid: number): void {
  try {
    assertSecureDirectory(directory, uid);
    return;
  } catch (error) {
    if (!isMissingPath(error)) {
      throw new MacAgentAccessError();
    }
  }
  try {
    mkdirSync(directory, { mode: 0o700, recursive: true });
    chmodSync(directory, 0o700);
    assertSecureDirectory(directory, uid);
  } catch {
    throw new MacAgentAccessError();
  }
}

function assertSecureAuthorizationFile(file: string, uid: number): void {
  const metadata = lstatSync(file);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== uid ||
    (metadata.mode & 0o077) !== 0 ||
    metadata.size < 2 ||
    metadata.size > 64 * 1_024
  ) {
    throw new MacAgentAccessError();
  }
}

function storeLinuxAuthorization(
  keelOrigin: URL,
  authorization: MacAgentAuthorization,
  options: AgentAuthorizationStorageOptions,
): void {
  const uid = secureUid(options);
  const rootDirectory = linuxAuthorizationRootDirectory(keelOrigin, options);
  prepareSecureDirectory(rootDirectory, uid);
  const directory = linuxAgentAuthorizationDirectory(
    keelOrigin,
    authorization.target,
    options,
  );
  prepareSecureDirectory(directory, uid);
  const destination = linuxAgentAuthorizationPath(
    keelOrigin,
    authorization.target,
    options,
  );
  const temporary = path.join(
    directory,
    `.authorization.${process.pid.toString()}.${randomUUID()}.tmp`,
  );
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, `${JSON.stringify(authorization)}\n`, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    chmodSync(temporary, 0o600);
    renameSync(temporary, destination);
    chmodSync(destination, 0o600);
  } catch {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
    throw new MacAgentAccessError();
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The atomic rename removes the temporary path on success.
    }
  }
  const stored = readMacAgentAuthorization(
    keelOrigin,
    authorization.target,
    options,
  );
  if (JSON.stringify(stored) !== JSON.stringify(authorization)) {
    throw new MacAgentAccessError();
  }
  try {
    unlinkSync(
      linuxAgentLegacyAuthorizationPath(
        keelOrigin,
        authorization.target,
        options,
      ),
    );
  } catch {
    // A hardened service can rotate its private file while the legacy parent is
    // read-only. Operator migration removes any legacy file before isolation.
  }
}

function readSecureAuthorizationFile(
  file: string,
  target: MacAgentTarget,
  uid: number,
): MacAgentAuthorization {
  assertSecureAuthorizationFile(file, uid);
  const authorization = MacAgentAuthorizationSchema.parse(
    JSON.parse(readFileSync(file, "utf8")) as unknown,
  );
  if (authorization.target !== target) {
    throw new MacAgentAccessError();
  }
  return authorization;
}

function readLinuxAuthorization(
  keelOrigin: URL,
  target: MacAgentTarget,
  options: AgentAuthorizationStorageOptions,
): MacAgentAuthorization {
  try {
    const uid = secureUid(options);
    const rootDirectory = linuxAuthorizationRootDirectory(keelOrigin, options);
    assertSecureDirectory(rootDirectory, uid);
    const directory = linuxAgentAuthorizationDirectory(
      keelOrigin,
      target,
      options,
    );
    try {
      assertSecureDirectory(directory, uid);
      return readSecureAuthorizationFile(
        linuxAgentAuthorizationPath(keelOrigin, target, options),
        target,
        uid,
      );
    } catch (error) {
      if (!isMissingPath(error)) {
        throw error;
      }
    }
    return readSecureAuthorizationFile(
      linuxAgentLegacyAuthorizationPath(keelOrigin, target, options),
      target,
      uid,
    );
  } catch (error) {
    throw error instanceof MacAgentAccessError
      ? error
      : new MacAgentAccessError();
  }
}

export function macAgentKeychainAccount(
  keelOrigin: URL,
  target: MacAgentTarget,
): string {
  return `${keelOrigin.origin}|${target}`;
}

export function storeMacAgentAuthorization(
  keelOrigin: URL,
  rawAuthorization: MacAgentAuthorization,
  options: AgentAuthorizationStorageOptions = {},
): void {
  const authorization = MacAgentAuthorizationSchema.parse(rawAuthorization);
  if ((options.platform ?? process.platform) === "linux") {
    storeLinuxAuthorization(keelOrigin, authorization, options);
    return;
  }
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new MacAgentAccessError();
  }
  const execute = options.executeSecurity ?? runSecurity;
  const serialized = JSON.stringify(authorization);
  const passwordHex = Buffer.from(serialized, "utf8").toString("hex");
  const account = macAgentKeychainAccount(keelOrigin, authorization.target);
  const result = execute(
    ["-q", "-i"],
    `add-generic-password -U -a ${account} -s ${KEYCHAIN_SERVICE} -l Keel-${authorization.target}-agent -T ${SECURITY_PATH} -X ${passwordHex}\n`,
  );
  if (result.status !== 0) {
    throw new MacAgentAccessError();
  }
  const stored = readMacAgentAuthorization(
    keelOrigin,
    authorization.target,
    options,
  );
  if (JSON.stringify(stored) !== serialized) {
    throw new MacAgentAccessError();
  }
}

export function readMacAgentAuthorization(
  keelOrigin: URL,
  target: MacAgentTarget,
  options: AgentAuthorizationStorageOptions = {},
): MacAgentAuthorization {
  if ((options.platform ?? process.platform) === "linux") {
    return readLinuxAuthorization(keelOrigin, target, options);
  }
  if ((options.platform ?? process.platform) !== "darwin") {
    throw new MacAgentAccessError();
  }
  const execute = options.executeSecurity ?? runSecurity;
  const result = execute([
    "find-generic-password",
    "-w",
    "-a",
    macAgentKeychainAccount(keelOrigin, target),
    "-s",
    KEYCHAIN_SERVICE,
  ]);
  if (result.status !== 0) {
    throw new MacAgentAccessError();
  }
  try {
    const authorization = MacAgentAuthorizationSchema.parse(
      JSON.parse(result.stdout) as unknown,
    );
    if (authorization.target !== target) {
      throw new MacAgentAccessError();
    }
    return authorization;
  } catch (error) {
    throw error instanceof MacAgentAccessError
      ? error
      : new MacAgentAccessError();
  }
}

export type MacAgentApiResult = {
  body: unknown;
  status: number;
};

export async function macAgentApi(
  authorization: MacAgentAuthorization,
  pathName: string,
  request: RequestInit,
  fetchImplementation: typeof fetch = fetch,
): Promise<MacAgentApiResult> {
  const parsed = MacAgentAuthorizationSchema.parse(authorization);
  const url = new URL(pathName, parsed.apiOrigin);
  if (url.origin !== parsed.apiOrigin || !url.pathname.startsWith("/api/")) {
    throw new MacAgentAccessError();
  }
  const headers = new Headers(request.headers);
  headers.set("Accept", "application/json");
  headers.set("Authorization", `Bearer ${parsed.token}`);
  const response = await fetchImplementation(url, {
    ...request,
    headers,
    redirect: "manual",
    signal: request.signal ?? AbortSignal.timeout(60_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new MacAgentAccessError();
  }
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
}

export const __macAgentAuthTest = {
  KEYCHAIN_SERVICE,
  SECURITY_PATH,
};
