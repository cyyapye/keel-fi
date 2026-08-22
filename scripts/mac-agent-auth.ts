import { spawnSync } from "node:child_process";

import {
  MacAgentAuthorizationSchema,
  type MacAgentAuthorization,
  type MacAgentTarget,
} from "../packages/domain/src/index";

const KEYCHAIN_SERVICE = "com.keel.mac-agent";
const SECURITY_PATH = "/usr/bin/security";

type SecurityResult = {
  status: number | null;
  stdout: string;
};

export type RunSecurity = (
  arguments_: readonly string[],
  input?: string,
) => SecurityResult;

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

export function macAgentKeychainAccount(
  keelOrigin: URL,
  target: MacAgentTarget,
): string {
  return `${keelOrigin.origin}|${target}`;
}

export function storeMacAgentAuthorization(
  keelOrigin: URL,
  rawAuthorization: MacAgentAuthorization,
  execute: RunSecurity = runSecurity,
): void {
  const authorization = MacAgentAuthorizationSchema.parse(rawAuthorization);
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
    execute,
  );
  if (JSON.stringify(stored) !== serialized) {
    throw new MacAgentAccessError();
  }
}

export function readMacAgentAuthorization(
  keelOrigin: URL,
  target: MacAgentTarget,
  execute: RunSecurity = runSecurity,
): MacAgentAuthorization {
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
