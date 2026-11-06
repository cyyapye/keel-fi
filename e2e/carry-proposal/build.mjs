import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const out = path.join(root, ".keel-local/carry-development/proposal/site");
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["e2e/carry-proposal/proposal.tsx"],
  outfile: path.join(out, "proposal.js"),
  bundle: true,
  jsx: "automatic",
  format: "iife",
  target: "es2023",
  alias: {
    "@keel/ui": path.join(root, "packages/ui/src/index.tsx"),
    react: path.join(root, "apps/web/node_modules/react"),
    "react-dom": path.join(root, "apps/web/node_modules/react-dom"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});
await cp(
  path.join(root, "e2e/carry-proposal/index.html"),
  path.join(out, "index.html"),
);
console.log(`Synthetic proposal v5: ${out}`);
