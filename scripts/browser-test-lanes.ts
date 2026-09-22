import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export const BROWSER_TEST_LANES = {
  mocked: [
    "agreement-security.visual.spec.ts",
    "automatic-investment-review.visual.spec.ts",
    "company-names.visual.spec.ts",
    "holdings-detail.visual.spec.ts",
    "holdings-import.visual.spec.ts",
    "investment-holdings.visual.spec.ts",
    "investment-review.visual.spec.ts",
  ],
  stateful: [
    "app-recovery.visual.spec.ts",
    "cash-accounts.visual.spec.ts",
    "goals.visual.spec.ts",
    "legal-entities.visual.spec.ts",
    "legal-name-resolution.visual.spec.ts",
    "navigation.visual.spec.ts",
    "obligations.visual.spec.ts",
    "observed-cash-flow.visual.spec.ts",
    "overview-links.visual.spec.ts",
    "plan-actual-monitoring.visual.spec.ts",
    "plan-inputs.visual.spec.ts",
    "portfolio-baseline.visual.spec.ts",
    "portfolio-dashboard.visual.spec.ts",
    "portfolio-watch.visual.spec.ts",
    "private-alpha.spec.ts",
    "purchase-details.visual.spec.ts",
    "provider-browser-lifecycle.spec.ts",
    "provider-legal-documents.spec.ts",
    "provider-portfolio-mac-agent.spec.ts",
    "provider-session.spec.ts",
    "sydecar-session-renewal.spec.ts",
  ],
} as const satisfies Record<string, readonly string[]>;

export type BrowserTestLane = keyof typeof BROWSER_TEST_LANES | "all";

export interface BrowserTestLaneConfig {
  readonly files: string[];
  readonly lane: BrowserTestLane;
  readonly workers: number;
}

export function validateBrowserTestLanes(
  actualSpecFiles: readonly string[],
  lanes: Readonly<Record<string, readonly string[]>> = BROWSER_TEST_LANES,
): void {
  const assigned = Object.values(lanes).flat();
  const duplicates = assigned.filter(
    (file, index) => assigned.indexOf(file) !== index,
  );
  const actual = [...actualSpecFiles].sort();
  const expected = [...new Set(assigned)].sort();
  const missing = actual.filter((file) => !expected.includes(file));
  const stale = expected.filter((file) => !actual.includes(file));

  if (duplicates.length > 0 || missing.length > 0 || stale.length > 0) {
    throw new Error(
      [
        "Browser test lane assignment must be exhaustive and exclusive.",
        duplicates.length > 0
          ? `Assigned more than once: ${[...new Set(duplicates)].join(", ")}.`
          : "",
        missing.length > 0 ? `Unassigned specs: ${missing.join(", ")}.` : "",
        stale.length > 0 ? `Missing specs: ${stale.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

export function discoverBrowserSpecFiles(directory: string): string[] {
  const visit = (current: string, prefix: string): string[] =>
    readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory())
        return visit(path.join(current, entry.name), relative);
      return entry.isFile() &&
        /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(entry.name)
        ? [relative]
        : [];
    });
  return visit(directory, "").sort();
}

export function validateMockedBrowserSpecs(e2eDirectory: string): void {
  for (const file of BROWSER_TEST_LANES.mocked) {
    const source = readFileSync(path.join(e2eDirectory, file), "utf8");
    if (!source.includes('from "./api-mocked-test"')) {
      throw new Error(
        `${file} must import the fail-closed mocked API fixture.`,
      );
    }
    if (
      /\bpage\.request\b|\brequest\.(?:get|post|put|patch|delete)\s*\(/u.test(
        source,
      )
    ) {
      throw new Error(
        `${file} bypasses browser API routing with a direct request.`,
      );
    }
    if (/\broute\.(?:continue|fetch)\s*\(/u.test(source)) {
      throw new Error(
        `${file} allows a mocked application route to reach the shared runtime.`,
      );
    }
  }
}

function parseBrowserTestLane(value: string | undefined): BrowserTestLane {
  const lane = value ?? "all";
  if (lane === "all" || lane === "mocked" || lane === "stateful") return lane;
  throw new Error(
    `KEEL_BROWSER_LANE must be one of all, mocked or stateful; received ${JSON.stringify(lane)}.`,
  );
}

export function resolveBrowserTestLane(options: {
  readonly e2eDirectory: string;
  readonly lane?: string | undefined;
}): BrowserTestLaneConfig {
  const actualSpecFiles = discoverBrowserSpecFiles(options.e2eDirectory);
  validateBrowserTestLanes(actualSpecFiles);
  validateMockedBrowserSpecs(options.e2eDirectory);
  const lane = parseBrowserTestLane(options.lane);
  const files =
    lane === "all" ? actualSpecFiles : [...BROWSER_TEST_LANES[lane]].sort();

  return {
    files: files.map((file) => `**/${file}`),
    lane,
    workers: lane === "mocked" ? 2 : 1,
  };
}

export function browserTestDirectory(repositoryRoot: string): string {
  return path.join(repositoryRoot, "e2e");
}
