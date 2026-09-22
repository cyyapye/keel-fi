import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BROWSER_TEST_EXECUTION,
  browserServerFailureExitCode,
  type BrowserTestLane,
  validateProductionBrowserBuild,
} from "./browser-test-lanes";
import { DEV_HOST } from "./dev-ports";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const lane = process.env.KEEL_BROWSER_LANE as BrowserTestLane | undefined;

if (lane === undefined || lane === "all" || !(lane in BROWSER_TEST_EXECUTION)) {
  throw new Error("The isolated browser server requires a named browser lane.");
}

const execution = BROWSER_TEST_EXECUTION[lane];
const runtimeRoot = path.resolve(rootDir, ".keel-local/e2e-lanes");
const expectedPersistRoot = path.join(runtimeRoot, lane);
const requestedPersistRoot = process.env.KEEL_LOCAL_PERSIST_TO;

if (
  !existsSync(expectedPersistRoot) ||
  lstatSync(expectedPersistRoot).isSymbolicLink()
) {
  throw new Error(`Browser lane ${lane} requires its prepared runtime.`);
}

if (execution.server === "stateful") {
  if (
    requestedPersistRoot === undefined ||
    path.resolve(requestedPersistRoot) !== expectedPersistRoot
  ) {
    throw new Error(
      `Browser lane ${lane} requires its prepared isolated D1 profile.`,
    );
  }
} else if (requestedPersistRoot !== undefined) {
  throw new Error("The mocked browser lane must not receive a D1 profile.");
}

if (execution.frontend === "production") {
  validateProductionBrowserBuild(path.join(rootDir, "apps/web"));
}

const environment = {
  ...process.env,
  KEEL_API_ORIGIN: `http://${DEV_HOST}:${execution.apiPort ?? 1}`,
  // Vite loads the shared config before applying CLI port overrides, so an
  // unused mocked API port must still satisfy the normal local-port parser.
  KEEL_API_PORT: String(execution.apiPort ?? 32_031),
  KEEL_BROWSER_VITE_CACHE_DIR: path.join(expectedPersistRoot, "vite-cache"),
  KEEL_WEB_PORT: String(execution.webPort),
  ...(execution.server === "stateful"
    ? {
        WRANGLER_LOG_PATH: path.join(
          expectedPersistRoot,
          "logs",
          "wrangler.log",
        ),
      }
    : {}),
};
const children = new Map<ChildProcess, string>();

function start(name: string, args: readonly string[]): void {
  const child = spawn("pnpm", args, {
    cwd: rootDir,
    env: environment,
    stdio: "inherit",
  });
  children.set(child, name);
}

let stopping = false;

function terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode === null && child.signalCode === null) child.kill(signal);
}

function stopAll(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  for (const child of children.keys()) terminateChild(child, signal);
  setTimeout(() => {
    for (const child of children.keys()) terminateChild(child, "SIGKILL");
  }, 1_000).unref();
}

if (execution.server === "stateful") {
  start("API", [
    "--filter",
    "@keel/api",
    "exec",
    "wrangler",
    "dev",
    "--env",
    "local",
    "--port",
    String(execution.apiPort),
    "--inspector-port",
    "0",
    "--persist-to",
    expectedPersistRoot,
  ]);
}

start("Web", [
  "--filter",
  "@keel/web",
  "exec",
  "vite",
  ...(execution.frontend === "production" ? ["preview"] : []),
  "--host",
  DEV_HOST,
  "--port",
  String(execution.webPort),
  "--strictPort",
]);

for (const [child, name] of children) {
  child.once("error", (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    process.exitCode = 1;
    stopAll("SIGTERM");
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    console.error(
      `${name} stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).`,
    );
    process.exitCode = browserServerFailureExitCode(code);
    stopAll("SIGTERM");
  });
}

process.once("SIGINT", () => {
  process.exitCode = 130;
  stopAll("SIGINT");
});
process.once("SIGTERM", () => {
  process.exitCode = 143;
  stopAll("SIGTERM");
});
