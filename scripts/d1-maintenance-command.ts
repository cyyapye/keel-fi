import { spawn } from "node:child_process";

const unavailable = () => new Error("Maintenance command is unavailable.");
const uncertain = () =>
  new Error("Maintenance command exceeded its envelope; outcome is unknown.");
const cancelled = () =>
  new Error("Maintenance command was cancelled; outcome is unknown.");

async function waitForGroupExit(pid: number) {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
      if ((error as NodeJS.ErrnoException).code !== "EPERM")
        throw new Error("Maintenance command cleanup is uncertain.", {
          cause: error,
        });
    }
    if (Date.now() >= deadline)
      throw new Error("Maintenance command cleanup is uncertain.");
    await new Promise<void>((done) => setTimeout(done, 10));
  }
}

export async function runMaintenanceCommand(
  program: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  options: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    signal?: AbortSignal;
  } = {},
) {
  if (process.platform === "win32") throw unavailable();
  if (options.signal?.aborted) throw cancelled();
  let child;
  try {
    child = spawn(program, args, {
      env: environment,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw unavailable();
  }
  let failure: Error | undefined;
  let exitCode: number | null | undefined;
  let bytes = 0;
  let finish!: () => void;
  const finished = new Promise<void>((done) => {
    finish = done;
  });
  let cleanup: Promise<void> | undefined;
  const terminate = () => {
    if (cleanup !== undefined) return;
    if (child.pid === undefined) cleanup = Promise.resolve();
    else {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          child.kill("SIGKILL");
      }
      cleanup = waitForGroupExit(child.pid);
    }
    finish();
  };
  const stop = (reason: Error) => {
    failure ??= reason;
    terminate();
  };
  const cancel = () => stop(cancelled());
  const closed = new Promise<void>((done) => child.once("close", () => done()));
  child.once("error", () => stop(unavailable()));
  child.once("exit", (code) => {
    exitCode = code;
    if (code !== 0)
      failure ??= new Error(
        "Maintenance command failed; capacity remains charged.",
      );
    // The launcher may exit while descendants still own remote work or pipes.
    terminate();
  });
  for (const output of [child.stdout, child.stderr])
    output.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > (options.maxOutputBytes ?? 1024 ** 2)) stop(uncertain());
    });
  const timer = setTimeout(
    () => stop(uncertain()),
    options.timeoutMs ?? 25 * 60_000,
  );
  options.signal?.addEventListener("abort", cancel, { once: true });
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  if (options.signal?.aborted) cancel();
  try {
    await finished;
    await cleanup;
    await closed;
    if (failure !== undefined) throw failure;
    if (exitCode !== 0) throw unavailable();
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
