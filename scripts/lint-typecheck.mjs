import { ESLint } from "eslint";
import ts from "typescript";
import tseslint from "typescript-eslint";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const rootTypecheck =
  "tsc --noEmit -p tsconfig.json && pnpm -r --filter './apps/**' --filter './packages/**' run typecheck && tsc --noEmit -p e2e/ui-catalogue/tsconfig.json";
const emissionOptions = [
  "declaration",
  "declarationMap",
  "declarationDir",
  "emitDeclarationOnly",
  "noEmitOnError",
  "outFile",
  "outDir",
];
const typescriptFile = /\.[cm]?tsx?$/u;
const diagnosticHost = {
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
  getCanonicalFileName: (file) =>
    ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(),
};

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

function discoverContexts(cwd) {
  const manifest = JSON.parse(
    readFileSync(resolve(cwd, "package.json"), "utf8"),
  );
  if (manifest.scripts?.typecheck !== rootTypecheck) {
    throw new Error("Unsupported root typecheck command");
  }
  const workspace = readFileSync(resolve(cwd, "pnpm-workspace.yaml"), "utf8")
    .split(/^allowBuilds:/mu)[0]
    .trim();
  if (workspace !== "packages:\n  - apps/*\n  - packages/*\n  - connectors/*") {
    throw new Error("Unsupported workspace selection");
  }
  const configs = ["tsconfig.json", "e2e/ui-catalogue/tsconfig.json"];
  for (const family of ["apps", "packages"]) {
    for (const entry of readdirSync(resolve(cwd, family), {
      withFileTypes: true,
    })) {
      if (entry.isSymbolicLink()) {
        throw new Error("Unsupported linked workspace");
      }
      if (!entry.isDirectory()) continue;
      const path = resolve(cwd, family, entry.name, "package.json");
      if (!existsSync(path)) continue;
      const data = JSON.parse(readFileSync(path, "utf8"));
      if (!data.scripts?.typecheck) continue;
      if (data.scripts.typecheck !== "tsc --noEmit") {
        throw new Error(`Unsupported workspace typecheck ${path}`);
      }
      configs.push(`${family}/${entry.name}/tsconfig.json`);
    }
  }
  return configs.sort();
}

function compilerContexts(cwd) {
  return new Map(
    discoverContexts(cwd).map((config) => {
      const path = resolve(cwd, config);
      const syntax = ts.readConfigFile(path, ts.sys.readFile);
      if (syntax.error) {
        throw new Error(ts.formatDiagnostics([syntax.error], diagnosticHost));
      }
      const parsed = ts.getParsedCommandLineOfConfigFile(
        path,
        { noEmit: true },
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic(diagnostic) {
            throw new Error(ts.formatDiagnostics([diagnostic], diagnosticHost));
          },
        },
      );
      if (!parsed) throw new Error(`Missing TypeScript configuration ${path}`);
      if (parsed.errors.length) {
        throw new Error(ts.formatDiagnostics(parsed.errors, diagnosticHost));
      }
      if (
        parsed.projectReferences?.length ||
        parsed.options.incremental ||
        parsed.options.composite
      ) {
        throw new Error(
          `Unsupported TypeScript references or incremental configuration ${path}`,
        );
      }
      if (parsed.options.allowJs || parsed.options.allowImportingTsExtensions) {
        throw new Error(`Unsupported TypeScript reuse options ${path}`);
      }
      if (
        emissionOptions.some((option) => parsed.options[option] !== undefined)
      ) {
        throw new Error(`Unsupported TypeScript emission options ${path}`);
      }
      return [
        path,
        { options: parsed.options, roots: parsed.fileNames.sort() },
      ];
    }),
  );
}

async function main() {
  if (process.argv.length !== 2)
    throw new Error("Usage: node scripts/lint-typecheck.mjs");
  const cwd = process.cwd();
  const expected = compilerContexts(cwd);
  const seen = new Set();
  const programs = new WeakSet();
  const diagnostics = [];
  const collector = {
    meta: { schema: [] },
    create(context) {
      return {
        Program() {
          const program = context.sourceCode.parserServices?.program;
          if (!program) return;
          if (context.languageOptions.parser !== tseslint.parser) {
            throw new Error("Unsupported ESLint parser in combined typecheck");
          }
          if (programs.has(program)) return;
          programs.add(program);
          const options = program.getCompilerOptions();
          const key = options.configFilePath;
          const known = expected.get(key);
          if (!known) throw new Error(`Unexpected TypeScript context ${key}`);
          if (
            JSON.stringify(program.getRootFileNames().slice().sort()) !==
            JSON.stringify(known.roots)
          ) {
            throw new Error(`TypeScript root files differ for ${key}`);
          }
          if (
            program
              .getRootFileNames()
              .some((path) => !typescriptFile.test(path)) ||
            program
              .getSourceFiles()
              .some(
                (file) =>
                  !typescriptFile.test(file.fileName) &&
                  !file.fileName.endsWith(".json"),
              )
          ) {
            throw new Error(
              `Unsupported TypeScript source extension for ${key}`,
            );
          }
          const actual = { ...options, noEmit: true };
          if (actual.allowNonTsExtensions !== true) {
            throw new Error(
              `Unexpected TypeScript parser adapter options ${key}`,
            );
          }
          delete actual.allowNonTsExtensions;
          if (
            JSON.stringify(stable(actual)) !==
            JSON.stringify(stable(known.options))
          ) {
            throw new Error(`TypeScript compiler options differ for ${key}`);
          }
          if (seen.has(key))
            throw new Error(`Replaced TypeScript program for ${key}`);
          seen.add(key);
          diagnostics.push(...ts.getPreEmitDiagnostics(program));
        },
      };
    },
  };
  const eslint = new ESLint({
    cwd,
    overrideConfig: [
      {
        files: ["**/*.{ts,tsx}"],
        plugins: { "keel-types": { rules: { diagnostics: collector } } },
        rules: { "keel-types/diagnostics": "error" },
      },
    ],
  });
  const results = await eslint.lintFiles(["."]);
  const configurations = await Promise.all(
    results.map((result) => eslint.calculateConfigForFile(result.filePath)),
  );
  if (configurations.some((configuration) => configuration?.processor)) {
    throw new Error("Unsupported ESLint processor in combined typecheck");
  }
  const formatter = await eslint.loadFormatter("stylish");
  const lintOutput = formatter.format(results);
  if (lintOutput) process.stdout.write(lintOutput);
  const missing = [...expected.keys()].filter((key) => !seen.has(key));
  if (missing.length) {
    throw new Error(`Missing TypeScript contexts ${missing.join(", ")}`);
  }
  if (diagnostics.length) {
    process.stdout.write(ts.formatDiagnostics(diagnostics, diagnosticHost));
  }
  const lintErrors = results.reduce(
    (total, result) => total + result.errorCount,
    0,
  );
  const warnings = results.reduce(
    (total, result) => total + result.warningCount,
    0,
  );
  console.log(
    JSON.stringify({
      contexts: seen.size,
      lintFiles: results.length,
      lintErrors,
      warnings,
      typeDiagnostics: diagnostics.length,
    }),
  );
  process.exitCode = lintErrors || warnings || diagnostics.length ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
