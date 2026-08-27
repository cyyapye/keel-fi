import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const webDist = resolve(import.meta.dirname, "../apps/web/dist");
const manifestPath = resolve(webDist, ".vite/manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const entry = Object.values(manifest).find((item) => item.isEntry === true);

if (entry === undefined) {
  throw new Error("The web build manifest is missing the main entry.");
}
const dynamicEntryNames = (entry.dynamicImports ?? []).map(
  (key) => manifest[key]?.name,
);
if (!dynamicEntryNames.includes("App")) {
  throw new Error(
    "The full application must stay behind the initial route shell.",
  );
}

const initialFiles = new Set([entry.file]);
const pendingImports = [...(entry.imports ?? [])];
while (pendingImports.length > 0) {
  const importKey = pendingImports.pop();
  const imported = manifest[importKey];
  if (imported === undefined || initialFiles.has(imported.file)) {
    continue;
  }
  initialFiles.add(imported.file);
  pendingImports.push(...(imported.imports ?? []));
}

const initialGzipBytes = (
  await Promise.all(
    [...initialFiles].map(
      async (file) =>
        gzipSync(await readFile(resolve(webDist, file))).byteLength,
    ),
  )
).reduce((total, bytes) => total + bytes, 0);
const INITIAL_JS_GZIP_BUDGET = 100 * 1024;

if (initialGzipBytes > INITIAL_JS_GZIP_BUDGET) {
  throw new Error(
    `Initial JavaScript is ${Math.ceil(initialGzipBytes / 1024)} KiB gzip; budget is ${INITIAL_JS_GZIP_BUDGET / 1024} KiB.`,
  );
}

console.log(
  `Initial JavaScript: ${Math.ceil(initialGzipBytes / 1024)} KiB gzip across ${initialFiles.size} ${initialFiles.size === 1 ? "file" : "files"}.`,
);
