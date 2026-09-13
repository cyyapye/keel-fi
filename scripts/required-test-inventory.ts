import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { z } from "zod";

const RequiredCases = z
  .object({
    schemaVersion: z.literal(1),
    vitest: z.array(z.string().min(1)).min(1),
    playwright: z.array(z.string().min(1)).min(1),
  })
  .strict();

export function assertRequiredCases(
  root: string,
  runner: "vitest" | "playwright",
  actual: string[],
) {
  // This committed inventory is reviewed separately from runner discovery.
  // Multiplicities matter: parameterized cases can share the same title.
  const expected = RequiredCases.parse(
    JSON.parse(
      readFileSync(resolve(root, ".tugling/required-cases.json"), "utf8"),
    ),
  )[runner];
  const remaining = new Map<string, number>();
  for (const identity of actual) {
    remaining.set(identity, (remaining.get(identity) ?? 0) + 1);
  }
  const missing = expected.filter((identity) => {
    const count = remaining.get(identity) ?? 0;
    if (count === 0) return true;
    remaining.set(identity, count - 1);
    return false;
  });
  const added = [...remaining].filter(([, count]) => count > 0);
  if (missing.length > 0 || added.length > 0) {
    throw new Error(
      `Required case inventory mismatch. Missing: ${missing.slice(0, 5).join("; ") || "none"}. ` +
        `Unregistered: ${
          added
            .slice(0, 5)
            .map(([identity]) => identity)
            .join("; ") || "none"
        }. ` +
        "Review intentional case changes with make refresh-required-cases.",
    );
  }
}

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
