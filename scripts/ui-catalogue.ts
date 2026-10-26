import { resolveDevPorts } from "./dev-ports";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(import.meta.dirname, "..");
const fixture = join(repository, "e2e/ui-catalogue");
const webRequire = createRequire(join(repository, "apps/web/package.json"));

/** Synthetic fixtures stay under e2e; the catalogue always bundles production UI. */
export async function buildUiCatalogue(returnUrl = "/"): Promise<string> {
  const paths = [
    "packages/ui/src/styles.css",
    "apps/web/src/styles.css",
    "e2e/ui-catalogue/keel-ui-catalogue.css",
    "e2e/ui-catalogue/keel-ui-candidates.css",
  ];
  const styles = await Promise.all(
    paths.map((path) => readFile(join(repository, path), "utf8")),
  );
  const declarations = styles[0]?.match(/:root\s*\{([^}]+)\}/u)?.[1];
  if (!declarations) throw new Error("Shared UI tokens are missing.");
  const tokens: Record<string, string> = {};
  for (const [, name, value] of declarations.matchAll(
    /(--[\w-]+):\s*([^;]+);/gu,
  )) {
    if (name && value) tokens[name] = value.trim();
  }
  const result = await build({
    absWorkingDir: fixture,
    entryPoints: [join(fixture, "keel-ui-catalogue.tsx")],
    bundle: true,
    write: false,
    minify: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      CATALOGUE_RETURN_URL: JSON.stringify(returnUrl),
      CATALOGUE_REVISION: JSON.stringify("local sources"),
      CATALOGUE_TOKENS: JSON.stringify(tokens),
    },
    alias: {
      "@keel/ui": join(repository, "packages/ui/src/index.tsx"),
      react: dirname(webRequire.resolve("react/package.json")),
      "react-dom": dirname(webRequire.resolve("react-dom/package.json")),
      recharts: dirname(webRequire.resolve("recharts/package.json")),
    },
  });
  const script = result.outputFiles[0]?.text.replaceAll(
    "</script",
    "<\\/script",
  );
  if (!script) throw new Error("Catalogue bundle is empty.");
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Keel · Theme &amp; components</title><style>${styles.join("\n")}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const html = await buildUiCatalogue(
    `http://127.0.0.1:${resolveDevPorts().webPort}/`,
  );
  const port = 18462;
  createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
  }).listen(port, "127.0.0.1", () => {
    console.log(
      `Keel UI catalogue: http://127.0.0.1:${port}/keel-ui-catalogue.html`,
    );
  });
}
