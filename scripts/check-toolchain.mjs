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

const corepack = spawnSync("corepack", ["--version"], {
  encoding: "utf8",
});

if (corepack.error || corepack.status !== 0) {
  console.error(
    "Keel requires Corepack. Install or enable it before running make bootstrap.",
  );
  process.exit(1);
}

const pnpm = spawnSync("pnpm", ["--version"], {
  encoding: "utf8",
});

if (pnpm.error || pnpm.status !== 0) {
  console.error(
    "Keel requires pnpm 11.9.0. Run corepack enable before make bootstrap.",
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
  `Toolchain ready: Node.js ${process.versions.node}, Corepack ${corepack.stdout.trim()}, pnpm ${pnpm.stdout.trim()}.`,
);
