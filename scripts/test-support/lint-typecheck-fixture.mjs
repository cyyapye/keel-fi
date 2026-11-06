import { fork } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { z } from "zod";

const limit = 1024 * 1024;
const requestSchema = z
  .object({
    id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    cwd: z.string().min(1).max(4096),
  })
  .strict();
const responseSchema = requestSchema
  .pick({ id: true })
  .extend({
    status: z.union([z.literal(0), z.literal(1)]),
    stdout: z.string(),
    stderr: z.string(),
  })
  .strict()
  .refine(
    ({ stdout, stderr }) =>
      Buffer.byteLength(stdout) + Buffer.byteLength(stderr) <= limit,
    "Fixture output limit",
  );
const budgetSchema = z.number().int().positive().max(20_000);

function outputLimit() {
  return Object.assign(new Error("Fixture output limit"), { code: "ENOBUFS" });
}

export class FixtureProcess {
  #owned;
  #pending;
  #phase = "idle";
  #nextId = 0;
  #closing;
  #unreported;

  constructor(worker = new URL(import.meta.url)) {
    this.worker = worker;
  }

  get pid() {
    return this.#owned?.process.pid;
  }

  #start() {
    const child = fork(fileURLToPath(this.worker), [], {
      execArgv: [],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let exited;
    const owned = {
      process: child,
      done: Promise.all([
        new Promise((resolve) => {
          exited = resolve;
        }),
        ...["stdout", "stderr"].map(
          (kind) =>
            new Promise((resolve) => {
              child[kind].once("end", resolve);
              child[kind].once("close", resolve);
            }),
        ),
      ]),
    };
    const pending = () =>
      this.#pending?.owned === owned ? this.#pending : undefined;
    const terminal = (error) => {
      if (this.#owned !== owned || this.#phase === "closed") return;
      const current = pending();
      if (current) this.#fail(current, error);
      else {
        this.#unreported ??= error;
        if (this.#phase !== "closing") this.#phase = "failed";
        child.kill("SIGKILL");
      }
    };
    for (const kind of ["stdout", "stderr"]) {
      child[kind].on("error", terminal);
      child[kind].setEncoding("utf8");
      child[kind].on("data", (data) => {
        const current = pending();
        if (!current) {
          if (data) terminal(new Error("Unexpected fixture output"));
          return;
        }
        if (current.error) return;
        current.bytes += Buffer.byteLength(data);
        if (current.bytes > limit) return this.#fail(current, outputLimit());
        current[kind] += data;
      });
    }
    child.on("message", (message) => {
      const current = pending();
      if (!current) return terminal(new Error("Unexpected fixture response"));
      if (current.error || this.#phase !== "running") return;
      if (performance.now() >= current.deadline)
        return this.#fail(
          current,
          Object.assign(new Error("Fixture deadline exceeded"), {
            code: "ETIMEDOUT",
          }),
        );
      const parsed = responseSchema.safeParse(message);
      if (!parsed.success)
        return this.#fail(
          current,
          parsed.error.issues.some(
            (issue) => issue.message === "Fixture output limit",
          )
            ? outputLimit()
            : new Error("Invalid fixture response"),
        );
      if (parsed.data.id !== current.id)
        return this.#fail(current, new Error("Invalid fixture response"));
      if (
        current.bytes +
          Buffer.byteLength(parsed.data.stdout) +
          Buffer.byteLength(parsed.data.stderr) >
        limit
      )
        return this.#fail(current, outputLimit());
      const result = {
        status: parsed.data.status,
        stdout: current.stdout + parsed.data.stdout,
        stderr: current.stderr + parsed.data.stderr,
      };
      this.#finish(current, undefined, result);
    });
    child.on("error", (error) => {
      if (!child.pid) exited();
      terminal(error);
    });
    child.once("exit", () => {
      exited();
      const current = pending();
      if (current && !current.error)
        this.#fail(current, new Error("Fixture child exited"));
      else if (this.#phase === "idle")
        terminal(new Error("Fixture child exited"));
    });
    return owned;
  }

  #finish(current, error, result) {
    if (this.#pending !== current || this.#owned !== current.owned) return;
    if (!error && (current.error || this.#phase !== "running")) return;
    clearTimeout(current.timer);
    this.#pending = undefined;
    if (this.#phase === "running") this.#phase = "idle";
    if (error) current.reject(error);
    else current.resolve(result);
  }

  #fail(current, error) {
    if (
      this.#pending !== current ||
      this.#owned !== current.owned ||
      current.error
    )
      return;
    current.error = error;
    if (this.#phase !== "closing") this.#phase = "failed";
    const child = current.owned.process;
    if (child.exitCode === null && child.signalCode === null && child.pid)
      child.kill("SIGKILL");
    void current.owned.done.then(() => this.#finish(current, current.error));
  }

  async request(cwd, budget = 20_000) {
    budgetSchema.parse(budget);
    const message = requestSchema.parse({ id: ++this.#nextId, cwd });
    if (this.#phase !== "idle") throw new Error("Fixture process is not idle");
    const deadline = performance.now() + budget;
    this.#owned ??= this.#start();
    const owned = this.#owned;
    this.#phase = "running";
    return new Promise((resolve, reject) => {
      const current = {
        owned,
        id: message.id,
        deadline,
        bytes: 0,
        stdout: "",
        stderr: "",
        resolve,
        reject,
        error: undefined,
        timer: undefined,
      };
      this.#pending = current;
      const remaining = deadline - performance.now();
      if (remaining <= 0)
        return this.#fail(
          current,
          Object.assign(new Error("Fixture deadline exceeded"), {
            code: "ETIMEDOUT",
          }),
        );
      current.timer = setTimeout(
        () =>
          this.#fail(
            current,
            Object.assign(new Error("Fixture deadline exceeded"), {
              code: "ETIMEDOUT",
            }),
          ),
        remaining,
      );
      owned.process.send(message, (error) => {
        if (error) this.#fail(current, error);
      });
    });
  }

  async close() {
    if (this.#closing) return this.#closing;
    this.#phase = "closing";
    this.#closing = (async () => {
      if (this.#pending)
        this.#fail(this.#pending, new Error("Fixture process closed"));
      const owned = this.#owned;
      if (owned) {
        const timer = setTimeout(() => owned.process.kill("SIGKILL"), 1000);
        if (owned.process.connected) owned.process.disconnect();
        await owned.done;
        clearTimeout(timer);
      }
      this.#phase = "closed";
      if (this.#unreported) throw this.#unreported;
    })();
    return this.#closing;
  }
}

function worker() {
  let running = false;
  process.on("message", async (message) => {
    const parsed = requestSchema.safeParse(message);
    if (!parsed.success || running) process.exit(2);
    running = true;
    try {
      const { check } = await import("../lint-typecheck.mjs");
      const result = responseSchema.parse({
        id: parsed.data.id,
        ...(await check(parsed.data.cwd)),
      });
      running = false;
      process.send(result, (error) => {
        if (error) process.exit(1);
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
  process.on("disconnect", () => process.exit(0));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (!process.send) throw new Error("Fixture worker requires IPC");
  worker();
}
