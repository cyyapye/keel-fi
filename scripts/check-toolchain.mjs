import { spawnSync } from "node:child_process";

const minimumNode = [22, 13, 0];
const currentNode = process.versions.node.split(".").map(Number);
const nodeIsSupported =
  minimumNode.some((minimumPart, index) => {
    const currentPart = currentNode[index] ?? 0;
    const earlierPartsMatch = minimumNode
      .slice(0, index)
      .every((part, earlierIndex) => part === currentNode[earlierIndex]);

    return earlierPartsMatch && currentPart > minimumPart;
  }) || minimumNode.every((part, index) => part === (currentNode[index] ?? 0));

if (!nodeIsSupported) {
  console.error(
    `Keel requires Node.js 22.13.0 or newer; found ${process.versions.node}.`,
  );
  process.exit(1);
}

const npm = spawnSync("npm", ["--version"], {
  encoding: "utf8",
});

if (npm.error || npm.status !== 0) {
  console.error(
    "Keel requires npm, which is bundled with Node.js, to prepare its pinned pnpm version.",
  );
  process.exit(1);
}

const pnpm = spawnSync("npx", ["--yes", "pnpm@11.9.0", "--version"], {
  encoding: "utf8",
});

if (pnpm.error || pnpm.status !== 0) {
  console.error(
    "npm could not prepare Keel's pinned pnpm 11.9.0. Check network access and retry make bootstrap.",
  );
  process.exit(1);
}

if (pnpm.stdout.trim() !== "11.9.0") {
  console.error(
    `Keel requires pnpm 11.9.0; found ${pnpm.stdout.trim() || "unknown"}.`,
  );
  process.exit(1);
}

console.log(
  `Toolchain ready: Node.js ${process.versions.node}, npm ${npm.stdout.trim()}, pnpm ${pnpm.stdout.trim()}.`,
);
