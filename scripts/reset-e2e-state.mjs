import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const localStateRoot = path.join(repositoryRoot, ".keel-local");
const e2eStateRoot = path.join(localStateRoot, "e2e");

if (
  path.basename(e2eStateRoot) !== "e2e" ||
  path.dirname(e2eStateRoot) !== localStateRoot
) {
  throw new Error("Refusing to reset an unexpected browser-test directory.");
}

await rm(e2eStateRoot, { force: true, recursive: true });
await mkdir(e2eStateRoot, { mode: 0o700, recursive: true });
await chmod(e2eStateRoot, 0o700);
console.info(`Reset isolated browser-test state at ${e2eStateRoot}.`);
