import childProcess, { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";

const root = resolve(import.meta.dirname, "..");
const command = resolve(root, "scripts/lint-typecheck.mjs");
type CheckResult = { status: 0 | 1; stdout: string; stderr: string };
type FixtureProcess = {
  readonly pid: number | undefined;
  request(cwd: string, budget?: number): Promise<CheckResult>;
  close(): Promise<void>;
};
const { FixtureProcess } = (await import(
  pathToFileURL(join(root, "scripts/test-support/lint-typecheck-fixture.mjs"))
    .href
)) as { FixtureProcess: new (worker?: URL) => FixtureProcess };
let session: FixtureProcess | undefined;
function fixtureSession() {
  return (session ??= new FixtureProcess());
}
async function closeSession() {
  const owned = session;
  session = undefined;
  await owned?.close();
}
afterEach(closeSession);

const typecheck = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  .scripts.typecheck as string;
type Fixture = {
  source?: string;
  options?: Record<string, unknown>;
  files?: Record<string, string>;
  rootConfig?: string;
  rootFiles?: string[];
  rootExtra?: Record<string, unknown>;
  ignores?: string[];
  rules?: Record<string, string>;
  configExtra?: string;
  preamble?: string;
  programDrift?: "options" | "roots";
  packageCommand?: string;
  workspace?: string;
};

async function withFixture<T>(
  fixture: Fixture,
  action: (cwd: string) => T | Promise<T>,
) {
  const cwd = mkdtempSync(join(tmpdir(), "keel-lint-types-"));
  const write = (name: string, value: string) => {
    mkdirSync(dirname(join(cwd, name)), { recursive: true });
    writeFileSync(join(cwd, name), value);
  };
  const options = {
    target: "ES2023",
    module: "ESNext",
    moduleResolution: "Bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  };
  try {
    mkdirSync(join(cwd, "apps"));
    mkdirSync(join(cwd, "packages"));
    symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
    write(
      "package.json",
      JSON.stringify({
        type: "module",
        scripts: { typecheck: fixture.packageCommand ?? typecheck },
      }),
    );
    write(
      "pnpm-workspace.yaml",
      fixture.workspace ??
        readFileSync(join(root, "pnpm-workspace.yaml"), "utf8"),
    );
    write(
      "main.ts",
      fixture.source ?? "export const title: string = document.title;\n",
    );
    write(
      "tsconfig.json",
      fixture.rootConfig ??
        JSON.stringify({
          compilerOptions: {
            ...options,
            lib: ["ES2023", "DOM"],
            ...fixture.options,
          },
          files: fixture.rootFiles ?? ["main.ts"],
          ...fixture.rootExtra,
        }),
    );
    write(
      "e2e/ui-catalogue/index.ts",
      'export const label: string = "synthetic";\n',
    );
    write(
      "e2e/ui-catalogue/tsconfig.json",
      JSON.stringify({
        compilerOptions: { ...options, lib: ["ES2023"] },
        files: ["index.ts"],
      }),
    );
    const drift = fixture.programDrift
      ? `import ts from ${JSON.stringify(pathToFileURL(join(root, "node_modules/typescript/lib/typescript.js")).href)};
import { fileURLToPath } from "node:url";
const parsed = ts.getParsedCommandLineOfConfigFile(fileURLToPath(new URL("./tsconfig.json", import.meta.url)), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} });
const program = ts.createProgram({ rootNames: ${fixture.programDrift === "roots" ? '[...parsed.fileNames, fileURLToPath(new URL("./extra.ts", import.meta.url))]' : "parsed.fileNames"}, options: { ...parsed.options, allowNonTsExtensions: true, ${fixture.programDrift === "options" ? "strict: false" : ""} } });
`
      : "";
    write(
      "eslint.config.mjs",
      `import base from ${JSON.stringify(pathToFileURL(join(root, "eslint.config.mjs")).href)};
${drift}
${fixture.preamble ?? ""}
export default [...base,
  { ignores: ${JSON.stringify(fixture.ignores ?? [])} },
  { files: ["**/*.{ts,tsx}"], languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }, rules: ${JSON.stringify(fixture.rules ?? {})} }
  ${fixture.programDrift ? ', { files: ["main.ts"], languageOptions: { parserOptions: { projectService: false, programs: [program] } } }' : ""}
  ${fixture.configExtra ?? ""}
];\n`,
    );
    for (const [name, value] of Object.entries(fixture.files ?? {}))
      write(name, value);
    return await action(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

async function run(fixture: Fixture = {}) {
  return withFixture(fixture, async (cwd) => {
    const result = await fixtureSession().request(cwd);
    return { status: result.status, output: result.stdout + result.stderr };
  });
}

function cli(cwd: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.error, result.stderr).toBeUndefined();
  return { status: result.status, output: result.stdout + result.stderr };
}

async function refusesWorker(
  cwd: string,
  worker: string,
  failure: { message?: string; code?: string },
) {
  const owned = new FixtureProcess(pathToFileURL(join(cwd, worker)));
  const result = owned.request(cwd);
  const pid = owned.pid;
  try {
    await expect(result).rejects.toMatchObject(failure);
    expect(pid).toBeTypeOf("number");
    expect(() => process.kill(pid!, 0)).toThrow();
  } finally {
    await owned.close();
  }
  expect(() => process.kill(pid!, 0)).toThrow();
}

it("preserves compiler diagnostics and the complete lint failure contract", async () => {
  await withFixture({}, (cwd) => {
    const clean = cli(cwd);
    expect(clean.status, clean.output).toBe(0);
    expect(clean.output).toContain('"contexts":2');
    const invalid = cli(cwd, ["--skip"]);
    expect(invalid.status, invalid.output).toBe(1);
    expect(invalid.output).toContain("Usage:");
  });
  await withFixture({ source: "export const value: string = 1;\n" }, (cwd) => {
    const bad = cli(cwd);
    expect(bad.status, bad.output).toBe(1);
    expect(bad.output).toContain("TS2322");
  });
  const clean = await run();
  expect(clean.status, clean.output).toBe(0);
  expect(clean.output).toContain('"contexts":2');
  for (const [fixture, failure] of [
    [{ source: "export const value: string = 1;\n" }, "TS2322"],
    [
      {
        source: "export const value: string = 1;\n",
        configExtra:
          ', { files: ["main.ts"], processor: { preprocess(text) { return [text.replace(": string", ": number")]; }, postprocess(messages) { return messages.flat(); } } }',
      },
      "Unsupported ESLint processor",
    ],
    [
      {
        source: "export const value: string = 1;\n",
        configExtra:
          ', { files: ["main.ts"], languageOptions: { parser: { ...base.find(entry => entry.languageOptions?.parser?.meta?.name === "typescript-eslint/parser").languageOptions.parser, parseForESLint(text, options) { return base.find(entry => entry.languageOptions?.parser?.meta?.name === "typescript-eslint/parser").languageOptions.parser.parseForESLint(text.replace(": string", ": number"), options); } } } }',
      },
      "Unsupported ESLint parser",
    ],
    [{ source: "const = 1;\n" }, "Parsing error"],
    [
      {
        source: 'import "./absent"; export const value = 1;\n',
        options: { noUncheckedSideEffectImports: true },
      },
      "TS2307",
    ],
    [
      {
        rootFiles: ["main.ts", "hidden.ts"],
        files: { "hidden.ts": "export const hidden: string = 1;\n" },
        ignores: ["hidden.ts"],
      },
      "TS2322",
    ],
    [{ files: { "failure.js": "syntheticMissing();\n" } }, "no-undef"],
    [
      {
        source: 'console.info("synthetic"); export const value = 1;\n',
        rules: { "no-console": "warn" },
      },
      '"warnings":1',
    ],
    [{ rootConfig: '{"compilerOptions": {"strict": true ' }, "TS1005"],
    [
      {
        rootExtra: { extends: "./broken.json" },
        files: { "broken.json": '{"compilerOptions": {"strict": true ' },
      },
      "TS1005",
    ],
    [{ options: { syntheticUnknownOption: true } }, "TS5023"],
  ] as [Fixture, string][]) {
    const result = await run(fixture);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(failure);
  }
  await withFixture(
    {
      rootFiles: ["main.ts", "hidden.ts"],
      files: { "hidden.ts": 'export const hidden: string = "synthetic";\n' },
      ignores: ["hidden.ts"],
    },
    async (cwd) => {
      const owned = fixtureSession();
      expect((await owned.request(cwd)).status).toBe(0);
      const hidden = join(cwd, "hidden.ts");
      const before = statSync(hidden);
      writeFileSync(hidden, "export const hidden: string = 1;\n");
      utimesSync(hidden, before.atime, before.mtime);
      const changed = await owned.request(cwd);
      expect(changed.status, changed.stdout + changed.stderr).toBe(1);
      expect(changed.stdout + changed.stderr).toContain("TS2322");
      writeFileSync(hidden, 'export const hidden: string = "synthetic";\n');
      utimesSync(hidden, before.atime, before.mtime);
      expect((await owned.request(cwd)).status).toBe(0);
      writeFileSync(
        join(cwd, "e2e/ui-catalogue/index.ts"),
        "export const title = document.title;\n",
      );
      const noDom = await owned.request(cwd);
      expect(noDom.status, noDom.stdout + noDom.stderr).toBe(1);
      expect(noDom.stdout + noDom.stderr).toContain("TS2584");
      const config = join(cwd, "e2e/ui-catalogue/tsconfig.json");
      const metadata = statSync(config);
      const parsed = JSON.parse(readFileSync(config, "utf8")) as {
        compilerOptions: { lib: string[] };
      };
      parsed.compilerOptions.lib.push("DOM");
      writeFileSync(config, JSON.stringify(parsed));
      utimesSync(config, metadata.atime, metadata.mtime);
      expect((await owned.request(cwd)).status).toBe(0);
    },
  );
  const nested = await run({
    preamble: `import { check } from ${JSON.stringify(pathToFileURL(command).href)}; await check(import.meta.dirname);`,
  });
  expect(nested.status, nested.output).toBe(1);
  expect(nested.output).toContain("Combined checks must run serially");
}, 90_000);

it("requires every canonical workspace context and rejects command drift", async () => {
  for (const [fixture, failure] of [
    [{ programDrift: "options" }, "TypeScript compiler options differ"],
    [
      {
        programDrift: "roots",
        files: { "extra.ts": "export const extra = 1;\n" },
      },
      "TypeScript root files differ",
    ],
    [
      {
        files: {
          "unregistered/tsconfig.json": JSON.stringify({
            compilerOptions: { noEmit: true, types: [] },
            files: ["source.ts"],
          }),
          "unregistered/source.ts": "export const value = 1;\n",
        },
      },
      "Unexpected TypeScript context",
    ],
    [{ ignores: ["e2e/**"] }, "Missing TypeScript contexts"],
    [
      {
        files: {
          "apps/synthetic/package.json": JSON.stringify({
            name: "synthetic",
            scripts: { typecheck: "tsc --noEmit" },
          }),
          "apps/synthetic/tsconfig.json": JSON.stringify({
            compilerOptions: { noEmit: true, types: [] },
            files: ["source.ts"],
          }),
          "apps/synthetic/source.ts": "export const value: number = 1;\n",
        },
        ignores: ["apps/**"],
      },
      "Missing TypeScript contexts",
    ],
    [
      {
        files: {
          "apps/synthetic/package.json": JSON.stringify({
            name: "synthetic",
            scripts: { typecheck: "tsc --noEmit" },
          }),
          "apps/synthetic/tsconfig.json": JSON.stringify({
            include: ["src/**/*.ts"],
          }),
        },
      },
      "TS18003",
    ],
    [{ packageCommand: "tsc --noEmit" }, "Unsupported root typecheck command"],
    [
      { workspace: "packages:\n  - apps/**\n" },
      "Unsupported workspace selection",
    ],
    [
      {
        files: {
          "apps/synthetic/package.json": JSON.stringify({
            name: "synthetic",
            scripts: { typecheck: "tsc --strict false" },
          }),
        },
      },
      "Unsupported workspace typecheck",
    ],
  ] as [Fixture, string][]) {
    const result = await run(fixture);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(failure);
  }
}, 90_000);

it("refuses unsupported compiler hosts and emission modes", async () => {
  for (const option of [
    "incremental",
    "composite",
    "allowJs",
    "allowImportingTsExtensions",
    "declaration",
    "declarationMap",
    "declarationDir",
    "emitDeclarationOnly",
    "noEmitOnError",
    "outFile",
    "outDir",
  ]) {
    const result = await run({
      options: {
        [option]: ["outFile", "outDir", "declarationDir"].includes(option)
          ? "synthetic-output"
          : true,
      },
    });
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain("Unsupported TypeScript");
  }
  for (const fixture of [
    { rootExtra: { references: [{ path: "./reference" }] } },
    {
      source:
        '/// <reference path="./unsupported.raw" />\nexport const value = 1;\n',
      files: { "unsupported.raw": "export const other = 1;\n" },
    },
  ]) {
    const result = await run(fixture);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/Unsupported TypeScript|TS6054/u);
  }
  await closeSession();
  await withFixture(
    {
      files: {
        "blocked.mjs": 'process.on("message", () => { while (true) {} });\n',
        "late.mjs":
          'process.on("message", ({ id }) => { setTimeout(() => process.send({ id, status: 0, stdout: "", stderr: "" }), 300); });\n',
        "invalid-then-valid.mjs":
          'process.on("message", ({ id }) => { process.send({ id, status: 2, stdout: "", stderr: "" }); process.send({ id, status: 0, stdout: "accepted", stderr: "" }); });\n',
        "instant.mjs":
          'process.on("message", ({ id }) => process.send({ id, status: 0, stdout: "", stderr: "" }));\n',
        "split-output.mjs":
          'process.on("message", ({ id }) => process.send({ id, status: 0, stdout: "x".repeat(600 * 1024), stderr: "y".repeat(600 * 1024) }));\n',
        "stream-output.mjs":
          'process.on("message", () => { process.stdout.write("x".repeat(600 * 1024)); process.stderr.write("y".repeat(600 * 1024)); });\n',
        "mixed-output.mjs":
          'process.on("message", ({ id }) => { process.stdout.write("x".repeat(600 * 1024), () => setTimeout(() => process.send({ id, status: 0, stdout: "", stderr: "y".repeat(600 * 1024) }), 20)); });\n',
        "output-on-disconnect.mjs":
          'process.on("message", ({ id }) => process.send({ id, status: 0, stdout: "", stderr: "" })); process.on("disconnect", () => { process.stdout.write("x".repeat(600 * 1024)); process.stderr.write("y".repeat(600 * 1024)); });\n',
      },
    },
    async (cwd) => {
      const blocked = new FixtureProcess(
        pathToFileURL(join(cwd, "blocked.mjs")),
      );
      await expect(blocked.request(cwd, 20_001)).rejects.toThrow();
      const timed = blocked.request(cwd, 1000);
      const pid = blocked.pid;
      try {
        await expect(timed).rejects.toHaveProperty("code", "ETIMEDOUT");
      } finally {
        await blocked.close();
      }
      expect(pid).toBeTypeOf("number");
      expect(() => process.kill(pid!, 0)).toThrow();
      const late = new FixtureProcess(pathToFileURL(join(cwd, "late.mjs")));
      const realTimeout = globalThis.setTimeout;
      let intercepted = false;
      const timer = vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation((handler, delay, ...args) => {
          if (typeof delay === "number" && delay > 0 && delay <= 100) {
            intercepted = true;
            return realTimeout(() => {}, 20_000);
          }
          return realTimeout(handler, delay, ...args);
        });
      const lateResult = late.request(cwd, 100);
      const latePid = late.pid;
      try {
        await expect(lateResult).rejects.toHaveProperty("code", "ETIMEDOUT");
        expect(intercepted).toBe(true);
      } finally {
        timer.mockRestore();
        await late.close();
      }
      expect(latePid).toBeTypeOf("number");
      expect(() => process.kill(latePid!, 0)).toThrow();
      await refusesWorker(cwd, "invalid-then-valid.mjs", {
        message: "Invalid fixture response",
      });
      await refusesWorker(cwd, "split-output.mjs", { code: "ENOBUFS" });
      await refusesWorker(cwd, "stream-output.mjs", { code: "ENOBUFS" });
      await refusesWorker(cwd, "mixed-output.mjs", { code: "ENOBUFS" });
      const originalFork = childProcess.fork;
      const cold = new FixtureProcess(pathToFileURL(join(cwd, "instant.mjs")));
      const fork = vi
        .spyOn(childProcess, "fork")
        .mockImplementation((...args) => {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
          return originalFork(...args);
        });
      syncBuiltinESMExports();
      try {
        const coldResult = cold.request(cwd, 100);
        const coldPid = cold.pid;
        await expect(coldResult).rejects.toHaveProperty("code", "ETIMEDOUT");
        expect(coldPid).toBeTypeOf("number");
        expect(() => process.kill(coldPid!, 0)).toThrow();
      } finally {
        fork.mockRestore();
        syncBuiltinESMExports();
        await cold.close();
      }
      const cancelled = new FixtureProcess(
        pathToFileURL(join(cwd, "instant.mjs")),
      );
      let closing: Promise<void> | undefined;
      const cancelFork = vi
        .spyOn(childProcess, "fork")
        .mockImplementation((...args) => {
          const child = originalFork(...args);
          child.prependOnceListener("message", () => {
            closing = cancelled.close();
          });
          return child;
        });
      syncBuiltinESMExports();
      try {
        const cancelledResult = cancelled.request(cwd);
        const cancelledPid = cancelled.pid;
        await expect(cancelledResult).rejects.toThrow("Fixture process closed");
        await closing;
        expect(cancelledPid).toBeTypeOf("number");
        expect(() => process.kill(cancelledPid!, 0)).toThrow();
      } finally {
        cancelFork.mockRestore();
        syncBuiltinESMExports();
        await cancelled.close();
      }
      const draining = new FixtureProcess(
        pathToFileURL(join(cwd, "output-on-disconnect.mjs")),
      );
      try {
        expect((await draining.request(cwd)).status).toBe(0);
        const drainingPid = draining.pid;
        await expect(draining.close()).rejects.toThrow(
          "Unexpected fixture output",
        );
        expect(drainingPid).toBeTypeOf("number");
        expect(() => process.kill(drainingPid!, 0)).toThrow();
      } finally {
        await draining.close().catch(() => {});
      }
    },
  );
}, 90_000);
