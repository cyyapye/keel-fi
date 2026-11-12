import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const ScreenshotModeSchema = z.enum(["functional", "canonical"]);
export type ScreenshotMode = z.infer<typeof ScreenshotModeSchema>;

export function resolveScreenshotMode(input: {
  mode?: string | undefined;
  ci: boolean;
  platform: NodeJS.Platform;
  architecture: string;
  args?: readonly string[];
}): ScreenshotMode {
  const parsed = ScreenshotModeSchema.safeParse(
    input.mode ?? (input.ci ? "canonical" : "functional"),
  );
  if (!parsed.success)
    throw new Error("KEEL_SCREENSHOT_MODE must be functional or canonical.");
  const mode = parsed.data;
  if (input.ci && mode !== "canonical")
    throw new Error("CI requires KEEL_SCREENSHOT_MODE=canonical.");
  if (mode === "canonical" && input.args?.includes("--ignore-snapshots"))
    throw new Error("Canonical screenshots cannot use --ignore-snapshots.");
  if (
    mode === "canonical" &&
    (input.platform !== "linux" || input.architecture !== "x64")
  ) {
    throw new Error(
      "Canonical screenshots require Linux x64 to match CI. " +
        "See docs/deployment/linux-test-cleanup.md.",
    );
  }
  if (
    mode !== "canonical" &&
    input.args?.some(
      (arg) =>
        arg !== "--update-snapshots=none" &&
        (arg.startsWith("-u") ||
          arg === "--update-snapshots" ||
          arg.startsWith("--update-snapshots=")),
    )
  )
    throw new Error(
      "Snapshot updates require KEEL_SCREENSHOT_MODE=canonical on Linux x64.",
    );
  return mode;
}

export const BROWSER_TEST_LANES = {
  mocked: [
    "automatic-investment-review.visual.spec.ts",
    "company-names.visual.spec.ts",
    "holdings-detail.visual.spec.ts",
    "holdings-import.visual.spec.ts",
    "investment-review.visual.spec.ts",
  ],
  "mocked-development": ["investment-holdings.visual.spec.ts"],
  "stateful-development": [
    "app-recovery.visual.spec.ts",
    "navigation.visual.spec.ts",
    "portfolio-watch.visual.spec.ts",
    "provider-portfolio-mac-agent.spec.ts",
    "provider-reconnect-access.spec.ts",
    "sydecar-session-renewal.spec.ts",
  ],
  "stateful-a": [
    "app-access.spec.ts",
    "carry-distributions.spec.ts",
    "cash-accounts.visual.spec.ts",
    "goals.visual.spec.ts",
    "manual-holdings.visual.spec.ts",
    "observed-cash-flow.visual.spec.ts",
    "plan-actual-monitoring.visual.spec.ts",
    "provider-browser-lifecycle.spec.ts",
    "provider-legal-documents.spec.ts",
  ],
  "stateful-b": [
    "cash-holdings.visual.spec.ts",
    "legal-name-resolution.visual.spec.ts",
    "purchase-details.visual.spec.ts",
    "share-basis.spec.ts",
    "legal-entities.visual.spec.ts",
    "manual-holdings.spec.ts",
    "obligations.visual.spec.ts",
    "overview-links.visual.spec.ts",
    "portfolio-baseline.visual.spec.ts",
    "portfolio-dashboard.visual.spec.ts",
    "position-links.visual.spec.ts",
    "private-alpha.spec.ts",
  ],
  "stateful-source": [
    "agreement-security.visual.spec.ts",
    "public-source-updates.spec.ts",
    "provider-session.spec.ts",
    "ui-catalogue.visual.spec.ts",
  ],
} as const satisfies Record<string, readonly string[]>;

const DEVELOPMENT_ONLY_STATEFUL_SPECS = [
  "app-recovery.visual.spec.ts",
  "navigation.visual.spec.ts",
  // The Watch screenshots intentionally assert Vite's development-mode demo
  // source disclosure; the production build truthfully renders production copy.
  "portfolio-watch.visual.spec.ts",
] as const;

export const BROWSER_TEST_EXECUTION = {
  mocked: {
    apiPort: null,
    frontend: "production",
    server: "mocked",
    webPort: 31_031,
    workers: 1,
  },
  "mocked-development": {
    apiPort: null,
    frontend: "production",
    server: "mocked",
    webPort: 31_034,
    workers: 1,
  },
  "stateful-development": {
    apiPort: 32_035,
    frontend: "development",
    server: "stateful",
    webPort: 31_035,
    workers: 1,
  },
  "stateful-a": {
    apiPort: 32_032,
    frontend: "production",
    server: "stateful",
    webPort: 31_032,
    workers: 1,
  },
  "stateful-b": {
    apiPort: 32_033,
    frontend: "production",
    server: "stateful",
    webPort: 31_033,
    workers: 1,
  },
  "stateful-source": {
    apiPort: 32_036,
    frontend: "production",
    server: "stateful",
    webPort: 31_036,
    workers: 1,
  },
} as const satisfies Record<
  keyof typeof BROWSER_TEST_LANES,
  {
    readonly apiPort: number | null;
    readonly frontend: "development" | "production";
    readonly server: "mocked" | "stateful";
    readonly webPort: number;
    readonly workers: number;
  }
>;

export const BROWSER_TEST_SCHEDULE = {
  mocked: [],
  "mocked-development": ["stateful-development"],
  "stateful-development": [],
  "stateful-a": [],
  "stateful-b": [],
  // Reuse completed worker slots; never overlap more than four browsers.
  "stateful-source": ["mocked"],
} as const satisfies Record<
  keyof typeof BROWSER_TEST_LANES,
  readonly (keyof typeof BROWSER_TEST_LANES)[]
>;

export type BrowserTestLane = keyof typeof BROWSER_TEST_LANES | "all";

export interface BrowserTestLaneConfig {
  readonly files: string[];
  readonly frontend: "development" | "production";
  readonly lane: BrowserTestLane;
  readonly server: "mocked" | "stateful";
  readonly workers: number;
}

export function browserServerFailureExitCode(code: number | null): number {
  return code !== null && code > 0 ? code : 1;
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
  const developmentStateful = new Set(lanes["stateful-development"] ?? []);
  const productionIncompatible = DEVELOPMENT_ONLY_STATEFUL_SPECS.filter(
    (file) => !developmentStateful.has(file),
  );

  if (
    duplicates.length > 0 ||
    missing.length > 0 ||
    stale.length > 0 ||
    productionIncompatible.length > 0
  ) {
    throw new Error(
      [
        "Browser test lane assignment must be exhaustive and exclusive.",
        duplicates.length > 0
          ? `Assigned more than once: ${[...new Set(duplicates)].join(", ")}.`
          : "",
        missing.length > 0 ? `Unassigned specs: ${missing.join(", ")}.` : "",
        stale.length > 0 ? `Missing specs: ${stale.join(", ")}.` : "",
        productionIncompatible.length > 0
          ? `Development-only stateful specs assigned outside stateful-development: ${productionIncompatible.join(", ")}.`
          : "",
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
  const mocked = new Set<string>([
    // The catalogue uses the production server and rejects every unhandled API.
    "ui-catalogue.visual.spec.ts",
    ...BROWSER_TEST_LANES.mocked,
    ...BROWSER_TEST_LANES["mocked-development"],
  ]);
  const productionServed = new Set<string>([
    ...BROWSER_TEST_LANES.mocked,
    ...BROWSER_TEST_LANES["mocked-development"],
    ...BROWSER_TEST_LANES["stateful-a"],
    ...BROWSER_TEST_LANES["stateful-b"],
  ]);
  for (const file of Object.values(BROWSER_TEST_LANES).flat()) {
    const source = readFileSync(path.join(e2eDirectory, file), "utf8");
    const usesMockedApi = source.includes('from "./api-mocked-test"');
    if (mocked.has(file) && !usesMockedApi) {
      throw new Error(
        `${file} must import the fail-closed mocked API fixture.`,
      );
    }
    if (productionServed.has(file) && /["'`](?:\/|\*\*\/)src\//u.test(source)) {
      throw new Error(
        `${file} requires development-only frontend source access.`,
      );
    }
    if (!usesMockedApi) continue;
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
  if (lane === "all" || lane in BROWSER_TEST_LANES)
    return lane as BrowserTestLane;
  throw new Error(
    `KEEL_BROWSER_LANE must be one of all, ${Object.keys(BROWSER_TEST_LANES).join(", ")}; received ${JSON.stringify(lane)}.`,
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
  const execution =
    lane === "all"
      ? {
          frontend: "development" as const,
          server: "stateful" as const,
          workers: 1,
        }
      : BROWSER_TEST_EXECUTION[lane];

  return {
    files: files.map((file) => `**/${file}`),
    frontend: execution.frontend,
    lane,
    server: execution.server,
    workers: execution.workers,
  };
}

export function browserTestDirectory(repositoryRoot: string): string {
  return path.join(repositoryRoot, "e2e");
}

export function validateProductionBrowserBuild(webRoot: string): void {
  const dist = path.resolve(webRoot, "dist");
  const index = path.join(dist, "index.html");
  if (
    !lstatSync(dist, { throwIfNoEntry: false })?.isDirectory() ||
    lstatSync(dist).isSymbolicLink() ||
    !lstatSync(index, { throwIfNoEntry: false })?.isFile() ||
    lstatSync(index).isSymbolicLink()
  ) {
    throw new Error("The production browser lane requires a built web dist.");
  }
  const html = readFileSync(index, "utf8");
  const assetDirectory = path.join(dist, "assets");
  const assetDirectoryInfo = lstatSync(assetDirectory, {
    throwIfNoEntry: false,
  });
  const assets = [
    ...html.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/gu),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  if (
    !assetDirectoryInfo?.isDirectory() ||
    assetDirectoryInfo.isSymbolicLink() ||
    !assets.some((asset) => asset.endsWith(".css")) ||
    !assets.some((asset) => asset.endsWith(".js")) ||
    assets.some((asset) => {
      const file = path.resolve(dist, `.${asset}`);
      const info = lstatSync(file, { throwIfNoEntry: false });
      return (
        !file.startsWith(`${dist}${path.sep}`) ||
        !info?.isFile() ||
        info.isSymbolicLink()
      );
    })
  ) {
    throw new Error(
      "The production browser lane requires complete built JS and CSS assets.",
    );
  }
}
