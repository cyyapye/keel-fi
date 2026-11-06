import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { runMaintenanceCommand } from "./d1-maintenance-command";

const owned: string[] = [];
const ProcessIdSchema = z.coerce
  .number()
  .int()
  .min(2)
  .max(Number.MAX_SAFE_INTEGER);
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    return false;
  }
};
async function pids(directory: string) {
  return Promise.all(
    ["launcher", "child", "grandchild"].map(async (role) =>
      ProcessIdSchema.parse(
        await readFile(join(directory, `${role}.pid`), "utf8"),
      ),
    ),
  );
}
async function ready(directory: string) {
  const deadline = Date.now() + 3_000;
  while (true) {
    try {
      return await pids(directory);
    } catch {
      if (Date.now() >= deadline)
        throw new Error("Synthetic tree did not start.");
      await pause(10);
    }
  }
}
async function gone(ids: number[]) {
  const deadline = Date.now() + 5_000;
  while (ids.some(alive)) {
    if (Date.now() >= deadline)
      throw new Error("Synthetic tree was not reaped.");
    await pause(10);
  }
}
afterEach(async () => {
  for (const directory of owned.splice(0)) {
    const ids = await Promise.all(
      ["owner", "launcher", "child", "grandchild"].map(async (role) =>
        readFile(join(directory, `${role}.pid`), "utf8")
          .then((value) => ProcessIdSchema.parse(value))
          .catch(() => undefined),
      ),
    );
    const known = ids.filter((pid): pid is number => pid !== undefined);
    for (const pid of known) {
      try {
        process.kill(pid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    await gone(known);
    await rm(directory, { recursive: true, force: true });
  }
});
async function tree(
  mode: "wait" | "overflow" | "failure" | "failure-pipes" | "success",
) {
  const directory = await mkdtemp(join(tmpdir(), "keel-command-test-"));
  owned.push(directory);
  const script = join(directory, "tree.cjs");
  await writeFile(
    script,
    `const {spawn} = require("node:child_process");
const {existsSync, writeFileSync, renameSync} = require("node:fs");
const {join} = require("node:path");
const [role, directory, mode] = process.argv.slice(2);
const publish = (name, value) => {
  const path = join(directory, name);
  writeFileSync(path + ".next", value);
  renameSync(path + ".next", path);
};
if (role !== "grandchild") publish(role + ".pid", String(process.pid));
process.on("SIGTERM", () => {});
if (role !== "grandchild") {
  spawn(process.execPath, [__filename, role === "launcher" ? "child" : "grandchild", directory, mode], {stdio: mode === "failure-pipes" ? ["ignore", "inherit", "inherit"] : "ignore"});
} else {
  const heartbeat = () => publish("heartbeat", String(Date.now()));
  heartbeat();
  publish("grandchild.pid", String(process.pid));
  setInterval(heartbeat, 10);
}
if (role === "launcher") {
  const timer = setInterval(() => {
    if (!existsSync(join(directory, "grandchild.pid"))) return;
    clearInterval(timer);
    if (mode === "overflow") process.stdout.write("private-output-".repeat(200000));
    if (mode === "failure" || mode === "failure-pipes") process.exit(7);
    if (mode === "success") process.exit(0);
  }, 10);
}
setInterval(() => {}, 1000);
`,
  );
  return { directory, args: [script, "launcher", directory, mode] };
}

describe("bounded maintenance process ownership", () => {
  it("maintenance-command-old-launcher-control reproduces a surviving real descendant", async () => {
    const fixture = await tree("wait");
    const launcher = spawn(process.execPath, fixture.args, { stdio: "ignore" });
    const closed = new Promise<void>((done) =>
      launcher.once("close", () => done()),
    );
    const ids = await ready(fixture.directory);
    launcher.kill("SIGKILL");
    await closed;
    expect(alive(ids[0]!)).toBe(false);
    expect(ids.slice(1).every(alive)).toBe(true);
    await pause(40);
    expect(
      await readFile(join(fixture.directory, "heartbeat"), "utf8"),
    ).toMatch(/^\d+$/u);
  });

  it.each([
    "overflow",
    "timeout",
    "abort",
    "failure",
    "failure-pipes",
    "success",
  ] as const)(
    "maintenance-command-owned-tree-%s awaits termination of launcher and both descendants",
    async (cause) => {
      const fixture = await tree(
        cause === "timeout" || cause === "abort" ? "wait" : cause,
      );
      const controller = new AbortController();
      const completed = runMaintenanceCommand(
        process.execPath,
        fixture.args,
        process.env,
        {
          timeoutMs: cause === "timeout" ? 2_000 : 10_000,
          maxOutputBytes: 32 * 1024,
          signal: controller.signal,
        },
      ).then(
        () => undefined,
        (error: unknown) => error,
      );
      const ids = await ready(fixture.directory);
      if (cause === "abort")
        controller.abort(new Error("private synthetic cancellation"));
      const outcome = await completed;
      expect(ids.map(alive)).toEqual([false, false, false]);
      if (cause === "success") expect(outcome).toBeUndefined();
      else {
        expect(outcome).toBeInstanceOf(Error);
        expect(String(outcome)).not.toContain("private");
        expect(String(outcome)).toMatch(
          cause === "failure" || cause === "failure-pipes"
            ? /capacity remains charged/u
            : /outcome is unknown/u,
        );
      }
    },
    15_000,
  );

  it("maintenance-command-private-errors redacts launch failure and never starts cancelled work", async () => {
    const secret = "synthetic-private-command";
    await expect(runMaintenanceCommand(secret, [secret], {})).rejects.toThrow(
      "Maintenance command is unavailable.",
    );
    const controller = new AbortController();
    controller.abort(new Error(secret));
    await expect(
      runMaintenanceCommand(
        process.execPath,
        ["-e", "process.exit(0)"],
        {},
        { signal: controller.signal },
      ),
    ).rejects.toThrow("outcome is unknown");
  });

  it.each(["SIGINT", "SIGTERM"] as const)(
    "maintenance-command-owner-%s cleans up before returning the cancellation outcome",
    async (signal) => {
      const fixture = await tree("wait");
      const ownerPath = join(fixture.directory, "owner.mjs");
      await writeFile(
        ownerPath,
        `
import {writeFileSync} from "node:fs";
import {runMaintenanceCommand} from ${JSON.stringify(resolve("scripts/d1-maintenance-command.ts"))};
writeFileSync(${JSON.stringify(join(fixture.directory, "owner.pid"))}, String(process.pid));
try {
  await runMaintenanceCommand(process.execPath, ${JSON.stringify(fixture.args)}, process.env);
} catch (error) {
  writeFileSync(${JSON.stringify(join(fixture.directory, "outcome"))}, String(error));
  process.exitCode = 1;
}
`,
      );
      const owner = spawn(process.execPath, ["--import", "tsx", ownerPath], {
        stdio: "ignore",
      });
      const closed = new Promise<number | null>((done) =>
        owner.once("close", done),
      );
      const ids = await ready(fixture.directory);
      owner.kill(signal);
      expect(await closed).toBe(1);
      expect(ids.map(alive)).toEqual([false, false, false]);
      expect(await readFile(join(fixture.directory, "outcome"), "utf8")).toBe(
        "Error: Maintenance command was cancelled; outcome is unknown.",
      );
    },
    15_000,
  );
});
