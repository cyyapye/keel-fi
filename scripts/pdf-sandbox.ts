import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { MAX_LEGAL_DOCUMENT_TEXT_BYTES } from "../packages/domain/src/provider-legal-documents";
import {
  LegalDocumentScanSchema,
  MAX_LEGAL_DOCUMENT_BYTES,
} from "../packages/domain/src/provider-legal-documents";

export const PDF_SANDBOX_MEMORY = 256 * 1024 * 1024;
export const PDF_SANDBOX_TIMEOUT_MS = 30_000;
export const PDF_SANDBOX_OUTPUT_BYTES = 6 * MAX_LEGAL_DOCUMENT_TEXT_BYTES + 512;
const READY = Buffer.from("KEEL_PDF_SANDBOX_READY_V1\n");
const ENTRYPOINT = [
  "/usr/bin/timeout",
  "--signal=KILL",
  "35",
  "/usr/bin/python3",
  "-I",
  "-B",
  "/opt/keel/reader.py",
];
const TMPFS =
  "rw,noexec,nosuid,nodev,size=16777216,mode=700,uid=65532,gid=65532";
const SAFE_ENV = ["PATH=/usr/bin:/bin", "LANG=C.UTF-8", "LC_ALL=C.UTF-8"];
// Fixed trusted profiles, never caller-supplied runtime flags. Increasing the
// scanner's database memory must not change the PDF parser's smaller boundary.
type SandboxProfile = "pdf" | "scanner";
const policies = {
  pdf: {
    memory: PDF_SANDBOX_MEMORY,
    timeoutMs: PDF_SANDBOX_TIMEOUT_MS,
    outputBytes: PDF_SANDBOX_OUTPUT_BYTES,
    entrypoint: ENTRYPOINT,
  },
  scanner: {
    memory: 3 * 1024 * 1024 * 1024,
    timeoutMs: 90_000,
    outputBytes: 4096,
    entrypoint: [
      "/usr/bin/timeout",
      "--signal=KILL",
      "95",
      "/usr/bin/python3",
      "-I",
      "-B",
      "/opt/keel/scanner.py",
    ],
  },
} as const;
export const PdfSandboxConfigSchema = z
  .object({
    version: z.literal(1),
    socket: z
      .string()
      .max(240)
      .refine(
        (value) =>
          isAbsolute(value) &&
          ![...value].some((character) => character.charCodeAt(0) < 32),
      ),
    // No mutable tags, remote endpoints, shell fragments or runtime overrides.
    image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  })
  .strict();
export type PdfSandboxConfig = z.infer<typeof PdfSandboxConfigSchema>;

export class PdfSandboxError extends Error {
  constructor(
    public readonly problem:
      "extractor_unavailable" | "limit_reached" | "unreadable",
  ) {
    super(problem);
  }
}

export function sandboxConfigPath() {
  return (
    process.env.KEEL_PDF_SANDBOX_CONFIG ??
    resolve(".keel-local/pdf-sandbox.json")
  );
}
export async function loadSandboxConfig(
  profile: SandboxProfile = "pdf",
): Promise<PdfSandboxConfig> {
  try {
    const file =
      sandboxConfigPath() + (profile === "scanner" ? ".scanner" : "");
    const metadata = await stat(file);
    if (metadata.size > 4096 || (metadata.mode & 0o077) !== 0)
      throw new Error("config must be bounded and owner-only");
    const config = PdfSandboxConfigSchema.parse(
      JSON.parse(await readFile(file, "utf8")),
    );
    if (!(await stat(config.socket)).isSocket())
      throw new Error("not a socket");
    return config;
  } catch {
    throw new PdfSandboxError("extractor_unavailable");
  }
}

export function assertSandboxEngine(value: unknown) {
  const info = z
    .object({
      OSType: z.literal("linux"),
      CgroupVersion: z.literal("2"),
      CgroupDriver: z.literal("systemd"),
      SecurityOptions: z.array(z.string()),
      MemoryLimit: z.literal(true),
      SwapLimit: z.literal(true),
      PidsLimit: z.literal(true),
      CpuCfsQuota: z.literal(true),
      CpuCfsPeriod: z.literal(true),
    })
    .parse(value);
  if (
    !info.SecurityOptions.includes("name=rootless") ||
    !info.SecurityOptions.includes("name=seccomp,profile=builtin")
  )
    throw new PdfSandboxError("extractor_unavailable");
}

export function sandboxCreateArgs(
  config: PdfSandboxConfig,
  name: string,
  profile: SandboxProfile = "pdf",
): string[] {
  PdfSandboxConfigSchema.parse(config);
  if (!/^keel-pdf-[a-f0-9-]{36}$/u.test(name))
    throw new Error("Invalid sandbox name");
  return [
    "create",
    "--name",
    name,
    "--label",
    "keel.pdf-sandbox=1",
    "--interactive",
    "--rm",
    "--pull=never",
    "--network=none",
    "--read-only",
    "--user=65532:65532",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges=true",
    "--ipc=none",
    "--cgroupns=private",
    `--memory=${policies[profile].memory.toString()}`,
    `--memory-swap=${policies[profile].memory.toString()}`,
    "--cpus=1",
    "--pids-limit=32",
    "--ulimit=core=0:0",
    "--ulimit=nofile=64:64",
    "--log-driver=none",
    "--restart=no",
    "--tmpfs",
    `/tmp:${TMPFS}`,
    ...SAFE_ENV.flatMap((value) => ["--env", value]),
    config.image,
  ];
}

// Attest the created container, not just our requested CLI flags. No private
// bytes are sent until this AND the worker's kernel-limit handshake pass.
export function assertSandboxContainer(
  value: unknown,
  image: string,
  profile: SandboxProfile = "pdf",
) {
  const container = z
    .object({
      Image: z.literal(image),
      State: z.object({ Status: z.literal("created") }),
      Config: z.object({
        User: z.literal("65532:65532"),
        Env: z.array(z.string()),
        Entrypoint: z.array(z.string()),
        Cmd: z.array(z.string()).nullable(),
        Volumes: z.record(z.string(), z.unknown()).nullable(),
      }),
      HostConfig: z.object({
        AutoRemove: z.literal(true),
        Privileged: z.literal(false),
        ReadonlyRootfs: z.literal(true),
        NetworkMode: z.literal("none"),
        IpcMode: z.literal("none"),
        PidMode: z.literal(""),
        UsernsMode: z.literal(""),
        CgroupnsMode: z.literal("private"),
        Memory: z.literal(policies[profile].memory),
        MemorySwap: z.literal(policies[profile].memory),
        NanoCpus: z.literal(1_000_000_000),
        PidsLimit: z.literal(32),
        CapAdd: z.array(z.string()).nullable(),
        CapDrop: z.array(z.string()),
        SecurityOpt: z.array(z.string()),
        Binds: z.array(z.string()).nullable(),
        Tmpfs: z.record(z.string(), z.string()),
        LogConfig: z.object({ Type: z.literal("none") }),
        RestartPolicy: z.object({ Name: z.literal("no") }),
        Ulimits: z.array(
          z.object({ Name: z.string(), Soft: z.number(), Hard: z.number() }),
        ),
      }),
      Mounts: z.array(
        z.object({ Type: z.literal("tmpfs"), Destination: z.literal("/tmp") }),
      ),
    })
    .parse(value);
  const host = container.HostConfig;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a) === JSON.stringify(b);
  if (
    !same(container.Config.Entrypoint, policies[profile].entrypoint) ||
    !same([...container.Config.Env].sort(), [...SAFE_ENV].sort()) ||
    (container.Config.Cmd?.length ?? 0) !== 0 ||
    Object.keys(container.Config.Volumes ?? {}).length !== 0 ||
    (host.Binds?.length ?? 0) !== 0 ||
    (host.CapAdd?.length ?? 0) !== 0 ||
    !same(host.CapDrop, ["ALL"]) ||
    !same(host.SecurityOpt, ["no-new-privileges=true"]) ||
    !same(host.Tmpfs, { "/tmp": TMPFS }) ||
    !host.Ulimits.some(
      (limit) => limit.Name === "core" && limit.Soft === 0 && limit.Hard === 0,
    ) ||
    !host.Ulimits.some(
      (limit) =>
        limit.Name === "nofile" && limit.Soft === 64 && limit.Hard === 64,
    )
  )
    throw new PdfSandboxError("extractor_unavailable");
}

type CommandOptions = {
  input?: Uint8Array;
  handshake?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
};
type CommandResult = { code: number | null; output: string; ready: boolean };
export type SandboxCommand = (
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export function dockerCommand(
  socket: string,
  configDirectory: string,
): SandboxCommand {
  return (args, options = {}) =>
    new Promise((fulfill, reject) => {
      // Only a local Unix socket, an empty Docker config, and a tiny CLI env. Never
      // inherit DOCKER_HOST/CONTEXT, proxy variables, plugins or agent credentials.
      const child = spawn(
        "docker",
        ["--config", configDirectory, "--host", `unix://${socket}`, ...args],
        {
          cwd: configDirectory,
          env: {
            PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
            LANG: "C.UTF-8",
          },
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      let ready = !options.handshake;
      let prefix = Buffer.alloc(0);
      let length = 0;
      const chunks: Buffer[] = [];
      let failure: PdfSandboxError | undefined;
      const stop = (problem: PdfSandboxError["problem"]) => {
        failure ??= new PdfSandboxError(problem);
        child.kill("SIGKILL");
      };
      const timeout = setTimeout(
        () => stop("limit_reached"),
        options.timeoutMs ?? 10_000,
      );
      child.stdout.on("data", (data: Buffer) => {
        if (failure !== undefined) return;
        let chunk = data;
        if (!ready) {
          prefix = Buffer.concat([prefix, chunk]);
          if (prefix.length < READY.length) {
            if (!READY.subarray(0, prefix.length).equals(prefix))
              stop("extractor_unavailable");
            return;
          }
          if (!prefix.subarray(0, READY.length).equals(READY)) {
            stop("extractor_unavailable");
            return;
          }
          ready = true;
          chunk = prefix.subarray(READY.length);
          prefix = Buffer.alloc(0);
          child.stdin.end(options.input);
        }
        length += chunk.length;
        if (length > (options.maxBytes ?? 64 * 1024)) stop("limit_reached");
        else chunks.push(chunk);
      });
      child.stdin.on("error", () => undefined);
      child.once("error", () => {
        clearTimeout(timeout);
        reject(new PdfSandboxError("extractor_unavailable"));
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        if (failure !== undefined) reject(failure);
        else
          fulfill({
            code,
            output: Buffer.concat(chunks).toString("utf8"),
            ready,
          });
      });
      if (!options.handshake) child.stdin.end(options.input);
    });
}

export const SandboxTextSchema = z
  .object({
    pageCount: z.number().int().min(0).max(150),
    problem: z.enum(["unreadable", "limit_reached"]).nullable(),
    text: z
      .string()
      .refine(
        (value) => Buffer.byteLength(value) <= MAX_LEGAL_DOCUMENT_TEXT_BYTES,
      ),
  })
  .strict()
  .refine((value) =>
    value.problem === null
      ? value.pageCount > 0
      : value.pageCount === 0 && value.text === "",
  );

async function removeSandbox(command: SandboxCommand, name: string) {
  // Killing the docker client alone leaves the PDF process alive. Remove the
  // exact container too; its independent 35s PID-1 watchdog covers parent death.
  const removal = await command(["rm", "--force", name]);
  if (removal.code !== 0) {
    // AutoRemove can win the removal race while deletion is still in progress.
    // Allow one second of bounded settling, but require a successful exact-name
    // absence check. A disconnected daemon or retained container is NOT success.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const remaining = await command([
        "ps",
        "--all",
        "--filter",
        `name=^/${name}$`,
        "--format",
        "{{.ID}}",
      ]);
      if (remaining.code !== 0)
        throw new PdfSandboxError("extractor_unavailable");
      if (remaining.output.trim() === "") return;
      if (attempt < 4) await delay(250);
    }
    throw new PdfSandboxError("extractor_unavailable");
  }
}

// The injected command is only for deterministic launcher/lifecycle tests. The
// production entry point below always uses the fixed local Docker adapter.
async function runIsolated(
  config: PdfSandboxConfig,
  input: Uint8Array,
  command: SandboxCommand,
  profile: SandboxProfile,
) {
  if (input.byteLength > MAX_LEGAL_DOCUMENT_BYTES)
    throw new PdfSandboxError("limit_reached");
  const name = `keel-pdf-${randomUUID()}`;
  let created = false;
  try {
    const info = await command(["info", "--format", "{{json .}}"]);
    if (info.code !== 0) throw new Error("engine unavailable");
    assertSandboxEngine(JSON.parse(info.output));
    // Mark before create: a timed-out CLI may still have created the named
    // container. Cleanup owns exactly this unpredictable, per-attempt name.
    created = true;
    const create = await command(sandboxCreateArgs(config, name, profile));
    if (create.code !== 0) throw new Error("create failed");
    const inspection = await command(["inspect", name]);
    if (inspection.code !== 0) throw new Error("inspect failed");
    assertSandboxContainer(
      z.array(z.unknown()).length(1).parse(JSON.parse(inspection.output))[0],
      config.image,
      profile,
    );
    const result = await command(["start", "--attach", "--interactive", name], {
      input,
      handshake: true,
      timeoutMs: policies[profile].timeoutMs,
      maxBytes: policies[profile].outputBytes,
    });
    if (!result.ready) throw new PdfSandboxError("extractor_unavailable");
    if (result.code === 137 || result.code === 124)
      throw new PdfSandboxError("limit_reached");
    if (result.code !== 0) throw new PdfSandboxError("unreadable");
    return result.output;
  } catch (error) {
    throw error instanceof PdfSandboxError
      ? error
      : new PdfSandboxError("extractor_unavailable");
  } finally {
    if (created) await removeSandbox(command, name);
  }
}

export async function runSandbox(
  config: PdfSandboxConfig,
  input: Uint8Array,
  command: SandboxCommand,
) {
  try {
    return SandboxTextSchema.parse(
      JSON.parse(await runIsolated(config, input, command, "pdf")),
    );
  } catch (error) {
    throw error instanceof PdfSandboxError
      ? error
      : new PdfSandboxError("unreadable");
  }
}

export async function runDocumentScan(
  config: PdfSandboxConfig,
  input: Uint8Array,
  command: SandboxCommand,
) {
  const result = LegalDocumentScanSchema.parse(
    JSON.parse(await runIsolated(config, input, command, "scanner")),
  );
  const { createHash } = await import("node:crypto");
  if (result.sha256 !== createHash("sha256").update(input).digest("hex"))
    throw new Error("scan_digest_mismatch");
  const age = Date.now() - Date.parse(result.scannedAt);
  if (age < -60_000 || age > 5 * 60_000) throw new Error("scan_time_invalid");
  return result;
}

export async function scanDocumentInSandbox(input: Uint8Array) {
  const config = await loadSandboxConfig("scanner");
  const directory = await mkdtemp(join(tmpdir(), "keel-scan-cli-"));
  try {
    return await runDocumentScan(
      config,
      input,
      dockerCommand(config.socket, directory),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function readPdfInSandbox(input: Uint8Array) {
  const config = await loadSandboxConfig();
  const directory = await mkdtemp(join(tmpdir(), "keel-pdf-cli-"));
  try {
    return await runSandbox(
      config,
      input,
      dockerCommand(config.socket, directory),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
