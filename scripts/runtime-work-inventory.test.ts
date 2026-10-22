import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

// Follow production entrypoints, including browser-evaluated fetches and local
// agent helpers. A new timer, queue fanout or remote call requires budget review.
const roots = [
  "apps/api/src/index.ts",
  "apps/web/src/main.tsx",
  "apps/web/src/worker.ts",
  "scripts/angellist-mac-agent.ts",
  "scripts/provider-portfolio-mac-agent.ts",
  "scripts/linux-agent-setup-session.ts",
  "scripts/ingestion-dlq-redrive.ts",
  "scripts/private-document-backup-job.ts",
  "scripts/preview-deployment-smoke.ts",
];
const configuration = ts.readConfigFile("tsconfig.json", (file) =>
  ts.sys.readFile(file),
);
const options = ts.parseJsonConfigFileContent(
  configuration.config,
  ts.sys,
  process.cwd(),
).options;

it("accounts for every runtime timer, network and queue call in the entrypoint graph", () => {
  const resolutionCache = ts.createModuleResolutionCache(
    process.cwd(),
    (file) => (ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase()),
    options,
  );
  const visited = new Set<string>();
  const entries: string[] = [];
  function visitFile(file: string) {
    file = resolve(file);
    if (visited.has(file) || file.includes("/node_modules/")) return;
    visited.add(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(node: ts.Node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const target = ts.resolveModuleName(
          node.moduleSpecifier.text,
          file,
          options,
          ts.sys,
          resolutionCache,
        ).resolvedModule?.resolvedFileName;
        if (target && /\.tsx?$/u.test(target)) visitFile(target);
      }
      if (ts.isCallExpression(node)) {
        if (
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments[0] &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const target = ts.resolveModuleName(
            node.arguments[0].text,
            file,
            options,
            ts.sys,
            resolutionCache,
          ).resolvedModule?.resolvedFileName;
          if (target && /\.tsx?$/u.test(target)) visitFile(target);
        }
        const callee = node.expression.getText(source);
        const kind =
          /(?:^|\.)(?:fetch|fetchImpl|fetchImplementation|fetcher|macAgentApi|goto|fallback)$/u.test(
            callee,
          )
            ? "network"
            : /(?:^|\.)(?:setTimeout|setInterval|sleep|delay)$/u.test(callee)
              ? "timer"
              : /\.(?:sendBatch)$/u.test(callee) ||
                  /(?:INGESTION_QUEUE\.send|queued\.retry)$/u.test(callee)
                ? "queue"
                : /(?:DOCUMENTS|automationStore|bucket|backupStore).*\.(?:get|put|delete|head|list)$/u.test(
                      callee,
                    )
                  ? "storage"
                  : null;
        if (kind) {
          let owner: ts.Node = node;
          while (
            owner.parent &&
            !ts.isFunctionDeclaration(owner) &&
            !ts.isMethodDeclaration(owner)
          )
            owner = owner.parent;
          const label =
            ts.isFunctionDeclaration(owner) || ts.isMethodDeclaration(owner)
              ? (owner.name?.getText(source) ?? "anonymous")
              : "module";
          const material = node.getText(source).replace(/\s+/gu, " ");
          const fingerprint = createHash("sha256")
            .update(material)
            .digest("hex")
            .slice(0, 16);
          entries.push(
            `${relative(process.cwd(), file)} | ${label} | ${kind} | ${callee} | ${fingerprint}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  roots.forEach(visitFile);
  // Scheduler and retry configuration can multiply unchanged call sites.
  for (const file of [
    "apps/api/wrangler.jsonc",
    "apps/web/wrangler.jsonc",
    ".github/workflows/private-document-backup.yml",
  ]) {
    entries.push(
      `${file} | deployment configuration | ${createHash("sha256")
        .update(readFileSync(file, "utf8"))
        .digest("hex")
        .slice(0, 16)}`,
    );
  }
  expect(visited.size).toBeGreaterThan(80);
  expect(entries.length).toBeGreaterThan(60);
  expect(entries.sort()).toMatchSnapshot();
});
