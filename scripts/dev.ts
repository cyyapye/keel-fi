import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { DEV_HOST, resolveDevPorts } from "./dev-ports";

const { apiPort, rootDir, webPort } = resolveDevPorts();

async function assertPortAvailable(name: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();

    server.once("error", () => {
      reject(
        new Error(
          `${name} port ${port} is unavailable. Set KEEL_WEB_PORT and KEEL_API_PORT to a free pair.`,
        ),
      );
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    server.listen(port, DEV_HOST);
  });
}

await Promise.all([
  assertPortAvailable("Web", webPort),
  assertPortAvailable("API", apiPort),
]);

console.log("Starting Keel local services:");
console.log(`  Web: http://${DEV_HOST}:${webPort}`);
console.log(`  API: http://${DEV_HOST}:${apiPort}/api/alpha`);
console.log("Use Ctrl+C to stop both services.");

const environment = {
  ...process.env,
  KEEL_API_ORIGIN: `http://${DEV_HOST}:${apiPort}`,
  KEEL_API_PORT: String(apiPort),
  KEEL_WEB_PORT: String(webPort),
  WRANGLER_LOG_PATH:
    process.env.WRANGLER_LOG_PATH ??
    path.join(rootDir, ".wrangler", "logs", "wrangler.log"),
};
const children = new Map<ChildProcess, string>();

function start(name: string, args: readonly string[]): ChildProcess {
  const child = spawn("pnpm", args, {
    cwd: rootDir,
    env: environment,
    stdio: "inherit",
  });
  children.set(child, name);
  return child;
}

function terminateChild(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill(signal);
}

let stopping = false;

function stopAll(signal: NodeJS.Signals): void {
  if (stopping) {
    return;
  }

  stopping = true;
  for (const child of children.keys()) {
    terminateChild(child, signal);
  }

  setTimeout(() => {
    for (const child of children.keys()) {
      terminateChild(child, "SIGKILL");
    }
  }, 5_000).unref();
}

start("API", [
  "--filter",
  "@keel/api",
  "exec",
  "wrangler",
  "dev",
  "--env",
  "local",
  "--port",
  String(apiPort),
]);
start("Web", [
  "--filter",
  "@keel/web",
  "exec",
  "vite",
  "--host",
  DEV_HOST,
  "--port",
  String(webPort),
  "--strictPort",
]);

for (const [child, name] of children) {
  child.once("error", (error) => {
    console.error(`${name} failed to start: ${error.message}`);
    process.exitCode = 1;
    stopAll("SIGTERM");
  });
  child.once("exit", (code, signal) => {
    if (stopping) {
      return;
    }

    if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
      console.log(`${name} stopped; stopping the remaining local service.`);
      process.exitCode = 0;
      stopAll("SIGTERM");
      return;
    }

    console.error(
      `${name} stopped unexpectedly (${signal ?? `exit ${code ?? 1}`}).`,
    );
    process.exitCode = code && code > 0 ? code : 1;
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
