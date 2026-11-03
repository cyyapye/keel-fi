import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const command = resolve(root, "scripts/lint-typecheck.mjs");
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
  programDrift?: "options" | "roots";
  packageCommand?: string;
  workspace?: string;
};

function run(fixture: Fixture = {}) {
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
export default [...base,
  { ignores: ${JSON.stringify(fixture.ignores ?? [])} },
  { files: ["**/*.{ts,tsx}"], languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } }, rules: ${JSON.stringify(fixture.rules ?? {})} }
  ${fixture.programDrift ? ', { files: ["main.ts"], languageOptions: { parserOptions: { projectService: false, programs: [program] } } }' : ""}
  ${fixture.configExtra ?? ""}
];\n`,
    );
    for (const [name, value] of Object.entries(fixture.files ?? {}))
      write(name, value);
    const result = spawnSync(process.execPath, [command], {
      cwd,
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    });
    expect(result.error, result.stderr).toBeUndefined();
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

it("preserves compiler diagnostics and the complete lint failure contract", () => {
  const clean = run();
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
    const result = run(fixture);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(failure);
  }
}, 90_000);

it("requires every canonical workspace context and rejects command drift", () => {
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
    const result = run(fixture);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toContain(failure);
  }
}, 90_000);

it("refuses unsupported compiler hosts and emission modes", () => {
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
    const result = run({
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
    const result = run(fixture);
    expect(result.status, result.output).toBe(1);
    expect(result.output).toMatch(/Unsupported TypeScript|TS6054/u);
  }
}, 90_000);
