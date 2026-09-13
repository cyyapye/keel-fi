import { execFileSync } from "node:child_process";
import { relative } from "node:path";

export function requiredTestFiles(
  root: string,
  runner: "vitest" | "playwright",
) {
  // Git's inventory is independent of the runner's include/exclude/filter
  // settings. Tugling separately requires the mapped rule sources to exist.
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter((file) =>
      runner === "vitest"
        ? !file.startsWith("e2e/") && /\.test\.tsx?$/u.test(file)
        : /^e2e\/.*\.spec\.ts$/u.test(file),
    );
}

export function projectTestPath(root: string, file: string) {
  return relative(root, file).replaceAll("\\", "/");
}

export function assertRequiredFiles(expected: string[], actual: Set<string>) {
  const missing = expected.filter((file) => !actual.has(file));
  if (expected.length === 0 || missing.length > 0) {
    throw new Error(
      `Required test files missing: ${missing.join(", ") || "empty inventory"}`,
    );
  }
}
