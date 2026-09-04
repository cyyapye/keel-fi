import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertSandboxContainer,
  assertSandboxEngine,
  dockerCommand,
  PdfSandboxConfigSchema,
  PdfSandboxError,
  runSandbox,
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
      { maxBytes: 2 },
    );
    child.stdout.write("toolarge");
    await expect(run).rejects.toThrow("limit_reached");
    const next = childProcess();
    const waiting = dockerCommand(config.socket, "/tmp/synthetic-empty-config")(
      ["info"],
      { timeoutMs: 10 },
    );
    const failure = expect(waiting).rejects.toThrow("limit_reached");
    await vi.advanceTimersByTimeAsync(10);
    await failure;
    expect(next.child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
