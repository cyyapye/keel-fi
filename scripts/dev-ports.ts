import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_HOST = "127.0.0.1";
export const PRIMARY_WEB_PORT = 4177;
export const PRIMARY_API_PORT = 8789;

const WORKTREE_WEB_PORT_BASE = 5_000;
const WORKTREE_API_PORT_BASE = 20_000;
const E2E_WEB_PORT_BASE = 35_000;
const E2E_API_PORT_BASE = 50_000;
const WORKTREE_PORT_SLOTS = 10_000;
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

interface ResolveDevPortOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly linkedWorktree?: boolean;
  readonly rootDir?: string;
}

export interface DevPorts {
  readonly apiPort: number;
  readonly rootDir: string;
  readonly webPort: number;
}

function isLinkedWorktree(rootDir: string): boolean {
  try {
    return !statSync(path.join(rootDir, ".git")).isDirectory();
  } catch {
    return true;
  }
}

function worktreeSlot(rootDir: string): number {
  const digest = createHash("sha256").update(rootDir).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) % WORKTREE_PORT_SLOTS;
}

function parsePort(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1024 and 65535.`);
  }

  return port;
}

export function resolveDevPorts(options: ResolveDevPortOptions = {}): DevPorts {
  const rootDir = path.resolve(options.rootDir ?? repositoryRoot);
  const env = options.env ?? process.env;
  const linkedWorktree = options.linkedWorktree ?? isLinkedWorktree(rootDir);
  const slot = linkedWorktree ? worktreeSlot(rootDir) : 0;
  const isolatedE2e = env.KEEL_E2E_ISOLATED === "1";
  const webPort =
    parsePort(env.KEEL_WEB_PORT, "KEEL_WEB_PORT") ??
    (isolatedE2e
      ? E2E_WEB_PORT_BASE + slot
      : linkedWorktree
        ? WORKTREE_WEB_PORT_BASE + slot
        : PRIMARY_WEB_PORT);
  const apiPort =
    parsePort(env.KEEL_API_PORT, "KEEL_API_PORT") ??
    (isolatedE2e
      ? E2E_API_PORT_BASE + slot
      : linkedWorktree
        ? WORKTREE_API_PORT_BASE + slot
        : PRIMARY_API_PORT);

  if (webPort === apiPort) {
    throw new Error("KEEL_WEB_PORT and KEEL_API_PORT must be different.");
  }

  return { apiPort, rootDir, webPort };
}
