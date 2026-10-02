import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireSandboxOwner } from "./pdf-sandbox-owner";
import { describeSandboxFailure } from "./pdf-sandbox-error";
import {
  assertSandboxContainer,
  assertSandboxEngine,
  dockerCommand,
  PdfSandboxConfigSchema,
  PdfSandboxError,
  runSandbox,
  runDocumentScan,
  sandboxCreateArgs,
  SandboxTextSchema,
  type SandboxCommand,
} from "./pdf-sandbox";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
const config = {
  version: 1 as const,
  socket: "/run/user/1234/docker.sock",
  image: `sha256:${"a".repeat(64)}`,
};
const name = "keel-pdf-11111111-1111-4111-8111-111111111111";
const engine = {
  OSType: "linux",
  CgroupVersion: "2",
  CgroupDriver: "systemd",
  SecurityOptions: ["name=rootless", "name=seccomp,profile=builtin"],
  MemoryLimit: true,
  SwapLimit: true,
  PidsLimit: true,
  CpuCfsQuota: true,
  CpuCfsPeriod: true,
};
function inspection() {
  return {
    Image: config.image,
    State: { Status: "created" },
    Config: {
      User: "65532:65532",
      Env: ["PATH=/usr/bin:/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8"],
      Entrypoint: [
        "/usr/bin/timeout",
        "--signal=KILL",
        "35",
        "/usr/bin/python3",
        "-I",
        "-B",
        "/opt/keel/reader.py",
      ],
      Cmd: null,
      Volumes: null,
    },
    HostConfig: {
      AutoRemove: true,
      Privileged: false,
      ReadonlyRootfs: true,
      NetworkMode: "none",
      IpcMode: "none",
      PidMode: "",
      UsernsMode: "",
      CgroupnsMode: "private",
      Memory: 268435456,
      MemorySwap: 268435456,
      NanoCpus: 1_000_000_000,
      PidsLimit: 32,
      CapAdd: null,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges=true"],
      Binds: null,
      Tmpfs: {
        "/tmp":
          "rw,noexec,nosuid,nodev,size=16777216,mode=700,uid=65532,gid=65532",
      },
      LogConfig: { Type: "none" },
      RestartPolicy: { Name: "no" },
      Ulimits: [
        { Name: "core", Soft: 0, Hard: 0 },
        { Name: "nofile", Soft: 64, Hard: 64 },
      ],
    },
    Mounts: [],
  };
}
const success = {
  pageCount: 1,
  problem: null,
  text: "Issuer: Synthetic Atlas LLC\f",
};
function fakeCommand(change?: (args: string[]) => void): SandboxCommand {
  return vi.fn((args: string[]) => {
    change?.(args);
    let output = "";
    if (args[0] === "info") output = JSON.stringify(engine);
    if (args[0] === "inspect") output = JSON.stringify([inspection()]);
    if (args[0] === "start") output = JSON.stringify(success);
    return Promise.resolve({ code: 0, output, ready: true });
  });
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("PDF sandbox policy", () => {
  it("keeps scanner limits separate and refuses a reader or weakened container as a scanner", () => {
    const value = inspection();
    expect(sandboxCreateArgs(config, name, "scanner")).toContain(
      "--memory=3221225472",
    );
    expect(sandboxCreateArgs(config, name)).toContain("--memory=268435456");
    expect(() =>
      assertSandboxContainer(value, config.image, "scanner"),
    ).toThrow();
    value.HostConfig.Memory = 3 * 1024 ** 3;
    value.HostConfig.MemorySwap = 3 * 1024 ** 3;
    value.Config.Entrypoint[2] = "95";
    value.Config.Entrypoint[6] = "/opt/keel/scanner.py";
    expect(() =>
      assertSandboxContainer(value, config.image, "scanner"),
    ).not.toThrow();
    expect(() => assertSandboxContainer(value, config.image)).toThrow();
    expect(() =>
      assertSandboxContainer(
        {
          ...value,
          HostConfig: { ...value.HostConfig, NetworkMode: "bridge" },
        },
        config.image,
        "scanner",
      ),
    ).toThrow();
  });
  it("refuses malformed scanner output after cleanup", async () => {
    const base = fakeCommand();
    const command: SandboxCommand = async (args, options) => {
      if (args[0] === "inspect") {
        const value = inspection();
        value.HostConfig.Memory = value.HostConfig.MemorySwap = 3 * 1024 ** 3;
        value.Config.Entrypoint[2] = "95";
        value.Config.Entrypoint[6] = "/opt/keel/scanner.py";
        return { code: 0, ready: true, output: JSON.stringify([value]) };
      }
      return base(args, options);
    };
    await expect(
      runDocumentScan(config, Buffer.from("synthetic"), command),
    ).rejects.toThrow();
    expect(vi.mocked(base).mock.calls.at(-1)?.[0][0]).toBe("rm");
  });
  it("requires HTTPS package mirrors before updating the reader image", async () => {
    const dockerfile = await readFile(
      new URL("./pdf-sandbox/Dockerfile", import.meta.url),
      "utf8",
    );
    const rewrite = dockerfile.indexOf("s|URIs: http://|URIs: https://|g");
    const rejection = dockerfile.indexOf("! grep -q '^URIs: http://'");
    const certificate = dockerfile.indexOf(
      "COPY --from=certificates /etc/ssl/cert.pem /etc/ssl/certs/ca-certificates.crt",
    );
    expect(dockerfile).toContain(
      "FROM alpine:3.22@sha256:14358309a308569c32bdc37e2e0e9694be33a9d99e68afb0f5ff33cc1f695dce AS certificates",
    );
    expect(certificate).toBeGreaterThan(-1);
    expect(rewrite).toBeGreaterThan(-1);
    expect(rewrite).toBeGreaterThan(certificate);
    expect(rejection).toBeGreaterThan(rewrite);
    expect(dockerfile.indexOf("apt-get update")).toBeGreaterThan(rejection);
    expect(dockerfile).toContain(
      "apt-get install -y --no-install-recommends ca-certificates poppler-utils python3",
    );
  });
  it("allows only a local socket and immutable image identity", () => {
    expect(PdfSandboxConfigSchema.parse(config)).toEqual(config);
    for (const image of ["ubuntu:latest", "--privileged", "sha256:bad"])
      expect(() =>
        PdfSandboxConfigSchema.parse({ ...config, image }),
      ).toThrow();
    for (const socket of [
      "tcp://host:2375",
      "ssh://host",
      "relative.sock",
      "/tmp/one\n--privileged",
    ])
      expect(() =>
        PdfSandboxConfigSchema.parse({ ...config, socket }),
      ).toThrow();
  });
  it("rejects rootful engines and unenforced or missing cgroup capabilities", () => {
    expect(() => assertSandboxEngine(engine)).not.toThrow();
    for (const change of [
      { SecurityOptions: ["name=seccomp,profile=builtin"] },
      { SecurityOptions: ["name=rootless"] },
      { CgroupVersion: "1" },
      { CgroupDriver: "none" },
      { MemoryLimit: false },
      { SwapLimit: false },
      { PidsLimit: false },
      { CpuCfsQuota: false },
    ])
      expect(() => assertSandboxEngine({ ...engine, ...change })).toThrow();
  });
  it("has no host mounts, credentials, network or privileges and bounds every resource", () => {
    const args = sandboxCreateArgs(config, name);
    expect(args).toEqual(
      expect.arrayContaining([
        "--pull=never",
        "--network=none",
        "--read-only",
        "--user=65532:65532",
        "--cap-drop=ALL",
        "--memory=268435456",
        "--memory-swap=268435456",
        "--cpus=1",
        "--pids-limit=32",
        "--log-driver=none",
        "--restart=no",
        "--rm",
        "--security-opt=no-new-privileges=true",
      ]),
    );
    expect(args).not.toContain("--privileged");
    expect(args).not.toContain("--mount");
    expect(args).not.toContain("--volume");
    expect(args.at(-1)).toBe(config.image);
    expect(() => sandboxCreateArgs(config, "--privileged")).toThrow();
  });
  it("attests actual Docker settings and rejects silent policy drift", () => {
    expect(() =>
      assertSandboxContainer(inspection(), config.image),
    ).not.toThrow();
    for (const change of [
      { Privileged: true },
      { NetworkMode: "bridge" },
      { ReadonlyRootfs: false },
      { Memory: 0 },
      { MemorySwap: -1 },
      { NanoCpus: 0 },
      { PidsLimit: 0 },
      { Binds: ["/host:/host"] },
      { SecurityOpt: ["seccomp=unconfined"] },
      { CapAdd: ["SYS_ADMIN"] },
      { LogConfig: { Type: "json-file" } },
      { Ulimits: [] },
    ]) {
      const value = inspection();
      expect(() =>
        assertSandboxContainer(
          { ...value, HostConfig: { ...value.HostConfig, ...change } },
          config.image,
        ),
      ).toThrow();
    }
    const value = inspection();
    expect(() =>
      assertSandboxContainer(
        {
          ...value,
          Config: {
            ...value.Config,
            Env: [...value.Config.Env, "TOKEN=synthetic"],
          },
        },
        config.image,
      ),
    ).toThrow();
    expect(() =>
      assertSandboxContainer(
        { ...value, Mounts: [{ Type: "bind", Destination: "/tmp" }] },
        config.image,
      ),
    ).toThrow();
  });
  it("validates text output, errors, page counts and decoded byte budgets", () => {
    expect(SandboxTextSchema.parse(success)).toEqual(success);
    for (const change of [
      { pageCount: 151 },
      { pageCount: 0 },
      { problem: "unreadable" },
      { text: "a".repeat(1024 * 1024 + 1) },
      { execute: "unexpected" },
    ])
      expect(() =>
        SandboxTextSchema.parse({ ...success, ...change }),
      ).toThrow();
  });
});

describe("PDF sandbox lifecycle", () => {
  it("attests before starting, sends only bytes, then removes exactly its own container", async () => {
    const command = fakeCommand();
    expect(await runSandbox(config, Buffer.from("synthetic"), command)).toEqual(
      success,
    );
    const calls = vi.mocked(command).mock.calls;
    expect(calls.map(([args]) => args[0])).toEqual([
      "info",
      "create",
      "inspect",
      "start",
      "rm",
    ]);
    const createdName = calls[1]![0][2];
    expect(calls.at(-1)![0]).toEqual(["rm", "--force", createdName]);
    expect(calls[3]![1]).toMatchObject({
      input: Buffer.from("synthetic"),
      handshake: true,
      timeoutMs: 30_000,
    });
  });
  it("never starts a PDF reader after failed attestation", async () => {
    const command = fakeCommand((args) => {
      if (args[0] === "inspect") throw new Error("unexpected mount");
    });
    await expect(
      runSandbox(config, Buffer.from("synthetic"), command),
    ).rejects.toThrow("extractor_unavailable");
    expect(vi.mocked(command).mock.calls.map(([args]) => args[0])).toEqual([
      "info",
      "create",
      "inspect",
      "rm",
    ]);
  });
  it.each(["create", "start"])(
    "removes a possibly created container after a %s timeout",
    async (stage) => {
      const command = fakeCommand((args) => {
        if (args[0] === stage) throw new PdfSandboxError("limit_reached");
      });
      await expect(
        runSandbox(config, Buffer.from("synthetic"), command),
      ).rejects.toThrow("limit_reached");
      expect(vi.mocked(command).mock.calls.at(-1)![0][0]).toBe("rm");
    },
  );
  it("does not mistake a disconnected Docker daemon for successful cleanup", async () => {
    const base = fakeCommand();
    const command: SandboxCommand = (args, options) =>
      ["rm", "ps"].includes(args[0]!)
        ? Promise.resolve({ code: 1, output: "", ready: false })
        : base(args, options);
    await expect(
      runSandbox(config, Buffer.from("synthetic"), command),
    ).rejects.toThrow("extractor_unavailable");
  });
  it("accepts AutoRemove only after a successful absence check", async () => {
    const base = fakeCommand();
    const command: SandboxCommand = (args, options) =>
      args[0] === "rm"
        ? Promise.resolve({ code: 1, output: "", ready: false })
        : base(args, options);
    expect(await runSandbox(config, Buffer.from("synthetic"), command)).toEqual(
      success,
    );
    expect(vi.mocked(base).mock.calls.at(-1)![0][0]).toBe("ps");
  });
  it("waits for in-progress AutoRemove to finish before accepting cleanup", async () => {
    vi.useFakeTimers();
    const base = fakeCommand();
    let absenceChecks = 0;
    const command: SandboxCommand = (args, options) => {
      if (args[0] === "rm")
        return Promise.resolve({ code: 1, output: "", ready: false });
      if (args[0] === "ps") {
        absenceChecks += 1;
        return Promise.resolve({
          code: 0,
          output: absenceChecks < 3 ? "synthetic-container-id\n" : "",
          ready: true,
        });
      }
      return base(args, options);
    };
    const result = expect(
      runSandbox(config, Buffer.from("synthetic"), command),
    ).resolves.toEqual(success);
    await vi.runAllTimersAsync();
    await result;
    expect(absenceChecks).toBe(3);
  });
  it("fails after a bounded wait if the owned container remains", async () => {
    vi.useFakeTimers();
    const base = fakeCommand();
    let absenceChecks = 0;
    const command: SandboxCommand = (args, options) => {
      if (args[0] === "rm")
        return Promise.resolve({ code: 1, output: "", ready: false });
      if (args[0] === "ps") {
        absenceChecks += 1;
        return Promise.resolve({
          code: 0,
          output: "synthetic-container-id\n",
          ready: true,
        });
      }
      return base(args, options);
    };
    const result = expect(
      runSandbox(config, Buffer.from("synthetic"), command),
    ).rejects.toThrow("extractor_unavailable");
    await vi.runAllTimersAsync();
    await result;
    expect(absenceChecks).toBe(5);
  });
});

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(),
  });
  const input: Buffer[] = [];
  child.stdin.on("data", (chunk: Buffer) => input.push(chunk));
  child.kill.mockImplementation(() => {
    child.emit("close", 137);
    return true;
  });
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
  return { child, input };
}
describe("PDF sandbox ownership transport", () => {
  it("admits only after readiness and releases only after confirmed cleanup and a clean exit", async () => {
    const { child, input } = childProcess();
    const admission = acquireSandboxOwner(
      config.socket,
      "/tmp/synthetic-empty-config",
      name,
    );
    child.stdout.write("KEEL_PDF_OWNER_READY_");
    expect(input).toHaveLength(0);
    child.stdout.write("V1\n");
    const owner = await admission;
    expect(owner.signal.aborted).toBe(false);
    const release = owner.release({ creationNeverStarted: true });
    expect(child.stdin.writableEnded).toBe(true);
    child.stdout.write("KEEL_PDF_OWNER_RELEASED_V1\n");
    child.emit("close", 0);
    await release;
    expect(owner.signal.aborted).toBe(true);
    expect(Buffer.concat(input).toString()).toBe(
      "KEEL_PDF_OWNER_NO_CREATE_V1\n",
    );
    expect(vi.mocked(spawn).mock.calls[0]).toMatchObject([
      "python3",
      expect.arrayContaining(["-I", "-B", config.socket, name]),
      {
        env: {
          PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
          LANG: "C.UTF-8",
        },
        stdio: ["pipe", "pipe", "ignore"],
      },
    ]);
  });
  it("refuses busy admission and a nonzero cleanup exit without exposing raw diagnostics", async () => {
    const first = childProcess();
    const admission = acquireSandboxOwner(
      config.socket,
      "/tmp/synthetic-empty-config",
      name,
    );
    first.child.stdout.write('{"reason":"runtime_busy"}\n');
    first.child.emit("close", 1);
    await expect(admission).rejects.toMatchObject({
      problem: "extractor_unavailable",
      diagnostic: { stage: "admission", reason: "runtime_busy" },
    });
    const next = childProcess();
    const admitted = acquireSandboxOwner(
      config.socket,
      "/tmp/synthetic-empty-config",
      name,
    );
    next.child.stdout.write("KEEL_PDF_OWNER_READY_V1\n");
    const owner = await admitted;
    const released = owner.release();
    next.child.stdout.write("KEEL_PDF_OWNER_RELEASED_V1\n");
    next.child.emit("close", 1);
    await expect(released).rejects.toMatchObject({
      diagnostic: { stage: "cleanup", reason: "cleanup_failed" },
    });
    expect(
      describeSandboxFailure(
        new AggregateError([
          new PdfSandboxError("extractor_unavailable", {
            stage: "admission",
            reason: "runtime_busy",
          }),
          new Error("synthetic private document text"),
        ]),
      ),
    ).toBe(
      "extractor_unavailable (admission: runtime_busy); sandbox verification failed",
    );
  });
  it("refuses malformed ownership output and stops an admitted operation when its owner dies", async () => {
    const first = childProcess();
    const admission = acquireSandboxOwner(
      config.socket,
      "/tmp/synthetic-empty-config",
      name,
    );
    first.child.stdout.write("unexpected synthetic private text\n");
    first.child.emit("close", 0);
    await expect(admission).rejects.toThrow("extractor_unavailable");
    const next = childProcess();
    const admitted = acquireSandboxOwner(
      config.socket,
      "/tmp/synthetic-empty-config",
      name,
    );
    next.child.stdout.write("KEEL_PDF_OWNER_READY_V1\n");
    const owner = await admitted;
    next.child.emit("close", null);
    expect(owner.signal.aborted).toBe(true);
    await expect(owner.release()).rejects.toThrow("extractor_unavailable");
  });
  it("waits for creation acknowledgment and refuses unconfirmed creation", async () => {
    const first = childProcess();
    const admitted = acquireSandboxOwner(
      config.socket,
      "/tmp/synthetic-empty-config",
      name,
    );
    first.child.stdout.write("KEEL_PDF_OWNER_READY_V1\n");
    const owner = await admitted;
    let settled = false;
    const creation = owner.creationSettled().then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    first.child.stdout.write("KEEL_PDF_OWNER_CREATE_SETTLED_V1\n");
    await creation;
    expect(settled).toBe(true);
    const release = owner.release();
    first.child.stdout.write("KEEL_PDF_OWNER_RELEASED_V1\n");
    first.child.emit("close", 0);
    await release;
    expect(Buffer.concat(first.input).toString()).toBe(
      "KEEL_PDF_OWNER_CREATE_SETTLED_V1\n",
    );
    const next = childProcess();
    const admission = acquireSandboxOwner(
      config.socket,
      "/tmp/synthetic-empty-config",
      name,
    );
    next.child.stdout.write("KEEL_PDF_OWNER_READY_V1\n");
    const unknown = await admission;
    const pending = unknown.creationSettled();
    next.child.stdout.write('{"reason":"creation_unconfirmed"}\n');
    next.child.emit("close", 1);
    await expect(pending).rejects.toMatchObject({
      diagnostic: { stage: "create", reason: "creation_unconfirmed" },
    });
    await expect(unknown.release()).rejects.toMatchObject({
      diagnostic: { stage: "cleanup", reason: "creation_unconfirmed" },
    });
  });
});
describe("PDF sandbox byte transport", () => {
  it("sends no bytes before the kernel handshake and never forwards secrets to Docker", async () => {
    vi.stubEnv("KEEL_SYNTHETIC_SECRET", "synthetic-only");
    vi.stubEnv("DOCKER_HOST", "tcp://unexpected.example:2375");
    const { child, input } = childProcess();
    const run = dockerCommand(config.socket, "/tmp/synthetic-empty-config")(
      ["start", name],
      { handshake: true, input: Buffer.from("synthetic") },
    );
    expect(input).toHaveLength(0);
    child.stdout.write("KEEL_PDF_SANDBOX_");
    expect(input).toHaveLength(0);
    child.stdout.write("READY_V1\n{}");
    expect(Buffer.concat(input).toString()).toBe("synthetic");
    child.emit("close", 0);
    expect(await run).toMatchObject({ code: 0, ready: true, output: "{}" });
    expect(vi.mocked(spawn).mock.calls[0]![2]).toMatchObject({
      env: {
        PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    expect(JSON.stringify(vi.mocked(spawn).mock.calls)).not.toContain(
      "synthetic-only",
    );
    expect(JSON.stringify(vi.mocked(spawn).mock.calls)).not.toContain(
      "unexpected.example",
    );
  });
  it("kills a worker with a malformed handshake without sending the PDF", async () => {
    const { child, input } = childProcess();
    const run = dockerCommand(config.socket, "/tmp/synthetic-empty-config")(
      ["start", name],
      { handshake: true, input: Buffer.from("synthetic") },
    );
    child.stdout.write("BAD");
    await expect(run).rejects.toThrow("extractor_unavailable");
    expect(input).toHaveLength(0);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("caps transport bytes and times out the client so container cleanup can run", async () => {
    vi.useFakeTimers();
    const { child } = childProcess();
    const run = dockerCommand(config.socket, "/tmp/synthetic-empty-config")(
      ["start", name],
      { handshake: true, maxBytes: 2 },
    );
    child.stdout.write("KEEL_PDF_SANDBOX_READY_V1\ntoolarge");
    await expect(run).rejects.toThrow("limit_reached");
    const next = childProcess();
    const waiting = dockerCommand(config.socket, "/tmp/synthetic-empty-config")(
      ["info"],
      { timeoutMs: 10 },
    );
    const failure = expect(waiting).rejects.toMatchObject({
      problem: "extractor_unavailable",
      diagnostic: { stage: "engine", reason: "control_timeout" },
    });
    await vi.advanceTimersByTimeAsync(10);
    await failure;
    expect(next.child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("distinguishes a startup failure from a document execution limit", async () => {
    vi.useFakeTimers();
    const { input } = childProcess();
    const run = dockerCommand(config.socket, "/tmp/synthetic-empty-config")(
      ["start", name],
      { handshake: true, input: Buffer.from("synthetic"), timeoutMs: 10 },
    );
    const failure = expect(run).rejects.toMatchObject({
      problem: "extractor_unavailable",
      diagnostic: { stage: "start", reason: "startup_timeout" },
    });
    await vi.advanceTimersByTimeAsync(10);
    await failure;
    expect(input).toHaveLength(0);
    const next = childProcess();
    const running = dockerCommand(config.socket, "/tmp/synthetic-empty-config")(
      ["start", name],
      { handshake: true, timeoutMs: 10 },
    );
    next.child.stdout.write("KEEL_PDF_SANDBOX_READY_V1\n");
    const execution = expect(running).rejects.toMatchObject({
      problem: "limit_reached",
      diagnostic: { stage: "execute", reason: "execution_timeout" },
    });
    await vi.advanceTimersByTimeAsync(10);
    await execution;
  });
  it("kills the attached client on ownership loss and refuses a lost owner before spawn", async () => {
    const { child } = childProcess();
    const controller = new AbortController();
    const command = dockerCommand(config.socket, "/tmp/synthetic-empty-config");
    const running = command(["start", name], { signal: controller.signal });
    controller.abort();
    await expect(running).rejects.toMatchObject({
      problem: "extractor_unavailable",
      diagnostic: { reason: "owner_lost" },
    });
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    const count = vi.mocked(spawn).mock.calls.length;
    await expect(
      command(["create"], { signal: controller.signal }),
    ).rejects.toThrow("extractor_unavailable");
    expect(vi.mocked(spawn).mock.calls).toHaveLength(count);
  });
});
