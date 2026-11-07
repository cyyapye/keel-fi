import { spawnSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { it, expect } from "vitest";
import { type SandboxCommand } from "./pdf-sandbox";
import {
  bootstrapPdfSandbox,
  checkPdfSandbox,
  registerPdfSandbox,
} from "./pdf-sandbox-setup";

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
const profiles = ["reader", "scanner", "probe"] as const;

async function fixture(
  run: (value: Awaited<ReturnType<typeof prepare>>) => Promise<void>,
) {
  const value = await prepare();
  try {
    await run(value);
  } finally {
    await new Promise<void>((done, reject) =>
      value.server.close((error) => (error ? reject(error) : done())),
    );
    await rm(value.root, { recursive: true, force: true });
  }
}

async function prepare() {
  const root = await mkdtemp(join(tmpdir(), "kp-"));
  const socket = join(root, "docker.sock");
  const server = createServer();
  await new Promise<void>((done, reject) => {
    server.once("error", reject);
    server.listen(socket, done);
  });
  const configPath = join(root, "configured", "runtime.json");
  const sharedPath = join(root, "registry", "runtime.json");
  const bindings = Object.fromEntries(
    profiles.map((profile, index) => [
      profile,
      {
        version: 1,
        socket,
        image: `sha256:${String(index + 1).repeat(64)}`,
      },
    ]),
  );
  const file = (base: string, profile: (typeof profiles)[number]) =>
    base + (profile === "reader" ? "" : `.${profile}`);
  const write = async (base: string) => {
    await mkdir(dirname(base), { recursive: true, mode: 0o700 });
    for (const profile of profiles)
      await writeFile(file(base, profile), JSON.stringify(bindings[profile]), {
        mode: 0o600,
      });
  };
  await write(configPath);
  const calls: string[][] = [];
  const command: SandboxCommand = (args, options) => {
    calls.push(args);
    expect(options).toEqual({ timeoutMs: 10_000, maxBytes: 128 * 1024 });
    if (args[0] === "info")
      return Promise.resolve({
        code: 0,
        ready: true,
        output: JSON.stringify(engine),
      });
    if (args[0] === "image" && args[1] === "inspect")
      return Promise.resolve({
        code: 0,
        ready: true,
        output: JSON.stringify(args.slice(2).map((Id) => ({ Id }))),
      });
    throw new Error("Setup may only inspect the existing daemon and images");
  };
  const options = { configPath, sharedPath, transport: () => command };
  return { root, server, bindings, file, write, calls, options };
}

it("reuses one registered PDF runtime across worktrees without replacing existing bindings", async () =>
  fixture(async ({ root, options, file, calls }) => {
    await registerPdfSandbox(options);
    expect((await lstat(options.sharedPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(dirname(options.sharedPath))).mode & 0o777).toBe(0o700);
    const configPath = join(root, "fresh", "runtime.json");
    await bootstrapPdfSandbox({ ...options, configPath });
    const before = await lstat(configPath);
    await bootstrapPdfSandbox({ ...options, configPath });
    expect((await lstat(configPath)).ino).toBe(before.ino);
    for (const profile of profiles) {
      expect(
        JSON.parse(await readFile(file(configPath, profile), "utf8")),
      ).toEqual(
        JSON.parse(await readFile(file(options.configPath, profile), "utf8")),
      );
      expect((await lstat(file(configPath, profile))).mode & 0o777).toBe(0o600);
    }
    // A different checkout can explicitly register newer images; an already
    // configured checkout must retain its own version on the next bootstrap.
    const newer = JSON.parse(await readFile(options.sharedPath, "utf8"));
    newer.reader.image = `sha256:${"a".repeat(64)}`;
    await writeFile(options.sharedPath, JSON.stringify(newer));
    await bootstrapPdfSandbox(options);
    expect(JSON.parse(await readFile(options.sharedPath, "utf8"))).toEqual(
      newer,
    );
    expect(JSON.parse(await readFile(configPath, "utf8")).image).not.toBe(
      newer.reader.image,
    );
    expect(calls).toHaveLength(8);
  }));

it("resumes matching partial PDF setup and preserves conflicting or unsafe local files", async () =>
  fixture(async ({ root, options, file }) => {
    await registerPdfSandbox(options);
    const configPath = join(root, "partial", "runtime.json");
    await bootstrapPdfSandbox({ ...options, configPath });
    await rm(configPath);
    const companion = await lstat(file(configPath, "scanner"));
    await bootstrapPdfSandbox({ ...options, configPath });
    expect((await lstat(file(configPath, "scanner"))).ino).toBe(companion.ino);
    await rm(configPath);
    const scanner = file(configPath, "scanner");
    const original = await readFile(scanner, "utf8");
    await writeFile(
      scanner,
      original.replace(/sha256:2+/u, `sha256:${"b".repeat(64)}`),
    );
    const conflicting = await readFile(scanner, "utf8");
    await expect(
      bootstrapPdfSandbox({ ...options, configPath }),
    ).rejects.toThrow("binding differs");
    expect(await readFile(scanner, "utf8")).toBe(conflicting);
    await expect(lstat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(scanner, original);
    await chmod(scanner, 0o644);
    await expect(
      bootstrapPdfSandbox({ ...options, configPath }),
    ).rejects.toThrow("owner-only");
    await rm(scanner);
    await symlink(file(options.configPath, "scanner"), scanner);
    await expect(
      bootstrapPdfSandbox({ ...options, configPath }),
    ).rejects.toThrow("owner-only");
    expect(
      await readFile(file(options.configPath, "scanner"), "utf8"),
    ).toContain("sha256:2222");
  }));

it("leaves a fresh worktree unbound when PDF configuration or runtime readiness fails", async () =>
  fixture(async ({ root, options }) => {
    const configPath = join(root, "fresh", "runtime.json");
    await expect(
      bootstrapPdfSandbox({ ...options, configPath }),
    ).rejects.toThrow("Missing PDF shared runtime configuration");
    await registerPdfSandbox(options);
    const original = await readFile(options.sharedPath, "utf8");
    const invalid = JSON.parse(original);
    invalid.scanner.socket += ".different";
    await writeFile(options.sharedPath, JSON.stringify(invalid));
    await expect(
      bootstrapPdfSandbox({ ...options, configPath }),
    ).rejects.toThrow("Invalid PDF shared runtime configuration");
    await writeFile(options.sharedPath, original);
    const failures: Array<[SandboxCommand, string]> = [
      [
        () => Promise.reject(new Error("private Docker diagnostic")),
        "cannot be inspected",
      ],
      [
        () =>
          Promise.resolve({
            code: 1,
            ready: true,
            output: "private Docker diagnostic",
          }),
        "unreachable",
      ],
      [
        () =>
          Promise.resolve({
            code: 0,
            ready: true,
            output: JSON.stringify({ ...engine, SecurityOptions: [] }),
          }),
        "rootless Linux policy",
      ],
      [
        (args) =>
          Promise.resolve({
            code: 0,
            ready: true,
            output: JSON.stringify(args[0] === "info" ? engine : []),
          }),
        "images are missing",
      ],
    ];
    for (const [command, message] of failures)
      await expect(
        bootstrapPdfSandbox({
          ...options,
          configPath,
          transport: () => command,
        }),
      ).rejects.toThrow(message);
    const absent = JSON.parse(original);
    for (const profile of profiles) absent[profile].socket += ".missing";
    await writeFile(options.sharedPath, JSON.stringify(absent));
    await expect(
      bootstrapPdfSandbox({ ...options, configPath }),
    ).rejects.toThrow("socket is unavailable");
    await expect(lstat(configPath)).rejects.toMatchObject({ code: "ENOENT" });
  }));

it("honors an explicit PDF configuration override and reports the recovery command", async () =>
  fixture(async ({ root, options }) => {
    await expect(checkPdfSandbox(options)).resolves.toHaveProperty(
      "version",
      1,
    );
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", resolve("scripts/pdf-sandbox-setup.ts"), "bootstrap"],
      {
        env: {
          ...process.env,
          KEEL_PDF_SANDBOX_CONFIG: join(root, "missing.json"),
        },
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing PDF");
    expect(result.stderr).toContain("make pdf-sandbox-register");
  }));
