import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

export const LOCAL_SEED_SCENARIO_DIRECTORY = ".keel-local/scenarios";
export const DEFAULT_LOCAL_SEED_SCENARIO = "default";

const LocalSeedScenarioSchema = z.enum(["default", "empty-holdings"]);
export type LocalSeedScenario = z.infer<typeof LocalSeedScenarioSchema>;

type LocalSeedScenarioDefinition = {
  readonly description: string;
  readonly expectedCurrentPositionCount: number;
  readonly minimumAcceptedValueDecreaseCount: number;
  readonly minimumAcceptedValueIncreaseCount: number;
  readonly minimumCanonicalExposureCount: number;
  readonly seedFiles: readonly string[];
  readonly version: number;
};

export const LocalSeedScenarios = {
  default: {
    description:
      "Planning data and fresh synthetic public-equity holdings with reviewed value history",
    expectedCurrentPositionCount: 5,
    minimumAcceptedValueDecreaseCount: 1,
    minimumAcceptedValueIncreaseCount: 1,
    minimumCanonicalExposureCount: 3,
    seedFiles: [
      "packages/database/seed/synthetic.sql",
      "packages/database/seed/scenarios/default.sql",
    ],
    version: 2,
  },
  "empty-holdings": {
    description: "Planning data with no current holdings",
    expectedCurrentPositionCount: 0,
    minimumAcceptedValueDecreaseCount: 0,
    minimumAcceptedValueIncreaseCount: 0,
    minimumCanonicalExposureCount: 0,
    seedFiles: ["packages/database/seed/synthetic.sql"],
    version: 1,
  },
} as const satisfies Record<LocalSeedScenario, LocalSeedScenarioDefinition>;

const ScenarioMarkerSchema = z
  .object({
    scenario: LocalSeedScenarioSchema,
    version: z.number().int().positive(),
  })
  .strict();

type ScenarioMarker = z.infer<typeof ScenarioMarkerSchema>;

const ScenarioCheckRowSchema = z
  .object({
    accepted_value_decreases: z.number().int().nonnegative(),
    accepted_value_increases: z.number().int().nonnegative(),
    canonical_exposures: z.number().int().nonnegative(),
    current_positions: z.number().int().nonnegative(),
    forecast_snapshots: z.number().int().nonnegative(),
    goal_versions_without_snapshot: z.number().int().nonnegative(),
    goals: z.number().int().nonnegative(),
    households: z.number().int().nonnegative(),
    primary_goals: z.number().int().nonnegative(),
  })
  .strict();

export type ScenarioCheckRow = z.infer<typeof ScenarioCheckRowSchema>;

const WranglerQueryOutputSchema = z
  .array(
    z
      .object({
        results: z.array(ScenarioCheckRowSchema),
        success: z.literal(true),
      })
      .passthrough(),
  )
  .min(1);

const MARKER_FILE_NAME = ".keel-seed-profile.json";

export function parseLocalSeedScenario(
  input: string | undefined,
): LocalSeedScenario {
  const result = LocalSeedScenarioSchema.safeParse(
    input ?? DEFAULT_LOCAL_SEED_SCENARIO,
  );
  if (!result.success) {
    throw new Error(
      `Unknown local seed scenario "${input}". Run make db-scenarios to list valid scenarios.`,
    );
  }
  return result.data;
}

export function resolveLocalScenarioPersistRoot(
  scenario: LocalSeedScenario,
  rootDir = repositoryRoot,
): string {
  const scenarioRoot = resolve(rootDir, LOCAL_SEED_SCENARIO_DIRECTORY);
  const persistRoot = resolve(scenarioRoot, scenario);
  const fromScenarioRoot = relative(scenarioRoot, persistRoot);
  if (
    fromScenarioRoot !== scenario ||
    persistRoot === scenarioRoot ||
    persistRoot === resolve(rootDir)
  ) {
    throw new Error(
      "Local seed persistence root is not an exact scenario directory.",
    );
  }
  return persistRoot;
}

function scenarioMarkerPath(persistRoot: string): string {
  return join(persistRoot, MARKER_FILE_NAME);
}

export function scenarioMarkerMatches(
  input: unknown,
  scenario: LocalSeedScenario,
): boolean {
  const result = ScenarioMarkerSchema.safeParse(input);
  return (
    result.success &&
    result.data.scenario === scenario &&
    result.data.version === LocalSeedScenarios[scenario].version
  );
}

function hasCurrentScenarioState(
  scenario: LocalSeedScenario,
  persistRoot: string,
): boolean {
  const markerPath = scenarioMarkerPath(persistRoot);
  if (!existsSync(markerPath) || !existsSync(join(persistRoot, "v3", "d1"))) {
    return false;
  }
  try {
    return scenarioMarkerMatches(
      JSON.parse(readFileSync(markerPath, "utf8")) as unknown,
      scenario,
    );
  } catch {
    return false;
  }
}

function assertExactPersistRoot(
  scenario: LocalSeedScenario,
  persistRoot: string,
  rootDir: string,
): void {
  if (persistRoot !== resolveLocalScenarioPersistRoot(scenario, rootDir)) {
    throw new Error("Refusing to reset an unexpected local D1 directory.");
  }
}

function cleanScenario(
  scenario: LocalSeedScenario,
  persistRoot: string,
  rootDir: string,
): void {
  assertExactPersistRoot(scenario, persistRoot, rootDir);
  rmSync(persistRoot, { force: true, recursive: true });
}

function commandEnvironment(persistRoot: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.KEEL_LOCAL_ACCEPTANCE_PROFILE_JSON;
  delete environment.KEEL_LOCAL_ACCEPTANCE_PROFILE_STDIN;
  return {
    ...environment,
    WRANGLER_LOG_PATH: join(persistRoot, "logs", "wrangler.log"),
  };
}

function wranglerExecutable(rootDir: string): string {
  return join(
    rootDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "wrangler.cmd" : "wrangler",
  );
}

function runWrangler(
  args: readonly string[],
  persistRoot: string,
  rootDir: string,
  failureMessage: string,
): void {
  const result = spawnSync(wranglerExecutable(rootDir), args, {
    cwd: rootDir,
    env: commandEnvironment(persistRoot),
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(failureMessage);
  }
}

function runWranglerQuery(
  sql: string,
  persistRoot: string,
  rootDir: string,
  failureMessage: string,
): ScenarioCheckRow {
  const result = spawnSync(
    wranglerExecutable(rootDir),
    [
      "d1",
      "execute",
      "keel-local",
      "--env",
      "local",
      "--local",
      "--config",
      "apps/api/wrangler.jsonc",
      "--persist-to",
      persistRoot,
      "--command",
      sql,
      "--json",
    ],
    {
      cwd: rootDir,
      encoding: "utf8",
      env: commandEnvironment(persistRoot),
    },
  );
  if (result.status !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(failureMessage);
  }
  try {
    const parsed = WranglerQueryOutputSchema.parse(
      JSON.parse(result.stdout) as unknown,
    );
    const row = parsed.at(-1)?.results.at(0);
    if (row === undefined) {
      throw new Error("Local D1 check returned no rows.");
    }
    return row;
  } catch {
    throw new Error("Local D1 check returned an invalid result.");
  }
}

function migrateScenario(persistRoot: string, rootDir: string): void {
  mkdirSync(join(persistRoot, "logs"), { mode: 0o700, recursive: true });
  runWrangler(
    [
      "d1",
      "migrations",
      "apply",
      "keel-local",
      "--env",
      "local",
      "--local",
      "--config",
      "apps/api/wrangler.jsonc",
      "--persist-to",
      persistRoot,
    ],
    persistRoot,
    rootDir,
    "Local D1 migration failed.",
  );
}

function applySeedFile(
  seedFile: string,
  persistRoot: string,
  rootDir: string,
): void {
  runWrangler(
    [
      "d1",
      "execute",
      "keel-local",
      "--env",
      "local",
      "--local",
      "--config",
      "apps/api/wrangler.jsonc",
      "--persist-to",
      persistRoot,
      "--file",
      seedFile,
    ],
    persistRoot,
    rootDir,
    `Local D1 seed failed while applying ${seedFile}.`,
  );
}

function writeScenarioMarker(
  scenario: LocalSeedScenario,
  persistRoot: string,
): void {
  const marker: ScenarioMarker = {
    scenario,
    version: LocalSeedScenarios[scenario].version,
  };
  writeFileSync(
    scenarioMarkerPath(persistRoot),
    `${JSON.stringify(marker)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

export function prepareLocalSeedScenario(options: {
  readonly forceReset?: boolean;
  readonly rootDir?: string;
  readonly scenario: LocalSeedScenario;
}): string {
  const rootDir = resolve(options.rootDir ?? repositoryRoot);
  const { scenario } = options;
  const persistRoot = resolveLocalScenarioPersistRoot(scenario, rootDir);
  const needsSeed =
    options.forceReset === true ||
    !hasCurrentScenarioState(scenario, persistRoot);

  if (needsSeed) {
    cleanScenario(scenario, persistRoot, rootDir);
  }

  try {
    migrateScenario(persistRoot, rootDir);
    if (needsSeed) {
      for (const seedFile of LocalSeedScenarios[scenario].seedFiles) {
        applySeedFile(seedFile, persistRoot, rootDir);
      }
      writeScenarioMarker(scenario, persistRoot);
      console.info(
        `Seeded local D1 scenario "${scenario}" at ${relative(rootDir, persistRoot)}.`,
      );
    } else {
      console.info(`Local D1 scenario "${scenario}" is ready.`);
    }
  } catch (error) {
    if (needsSeed) {
      cleanScenario(scenario, persistRoot, rootDir);
    }
    throw error;
  }

  return persistRoot;
}

function checkScenario(
  scenario: LocalSeedScenario,
  rootDir = repositoryRoot,
): void {
  const persistRoot = resolveLocalScenarioPersistRoot(scenario, rootDir);
  if (!hasCurrentScenarioState(scenario, persistRoot)) {
    throw new Error(
      `Local D1 scenario "${scenario}" is not seeded. Run make db-seed SCENARIO=${scenario}.`,
    );
  }
  const result = runWranglerQuery(
    `SELECT
       (SELECT COUNT(*) FROM households) AS households,
       (SELECT COUNT(*) FROM forecast_snapshots) AS forecast_snapshots,
       (SELECT COUNT(*) FROM goals) AS goals,
       (SELECT COUNT(*) FROM goals
        WHERE is_primary = 1 AND archived_at IS NULL) AS primary_goals,
       (SELECT COUNT(*)
        FROM goal_versions version
        LEFT JOIN goal_forecast_snapshots snapshot
          ON snapshot.goal_version_id = version.id
        WHERE snapshot.id IS NULL) AS goal_versions_without_snapshot,
       (SELECT COUNT(*) FROM holding_positions position
        WHERE NOT EXISTS (
          SELECT 1 FROM holding_position_continuities continuity
          WHERE continuity.predecessor_position_id = position.id
        )) AS current_positions,
       (SELECT COUNT(*)
        FROM holding_position_value_proposals proposal
        JOIN holding_position_value_reviews review
          ON review.proposal_id = proposal.id
         AND review.decision = 'accepted'
        WHERE proposal.prior_value_state = 'reported'
          AND proposal.value_minor > proposal.prior_value_minor
       ) AS accepted_value_increases,
       (SELECT COUNT(*)
        FROM holding_position_value_proposals proposal
        JOIN holding_position_value_reviews review
          ON review.proposal_id = proposal.id
         AND review.decision = 'accepted'
        WHERE proposal.prior_value_state = 'reported'
          AND proposal.value_minor < proposal.prior_value_minor
       ) AS accepted_value_decreases,
       (SELECT COUNT(*) FROM canonical_exposures) AS canonical_exposures;`,
    persistRoot,
    rootDir,
    `Local D1 scenario "${scenario}" failed its invariants.`,
  );
  assertScenarioCheck(scenario, result);
  console.info(
    `Local D1 scenario "${scenario}" passed: ${result.current_positions} current positions, ${result.canonical_exposures} canonical exposures.`,
  );
}

export function assertScenarioCheck(
  scenario: LocalSeedScenario,
  result: ScenarioCheckRow,
): void {
  const definition = LocalSeedScenarios[scenario];
  const positionsAreValid =
    definition.expectedCurrentPositionCount === 0
      ? result.current_positions === 0
      : result.current_positions >= definition.expectedCurrentPositionCount;
  if (
    result.households < 1 ||
    result.forecast_snapshots < 1 ||
    result.goals < 1 ||
    result.primary_goals < 1 ||
    result.goal_versions_without_snapshot !== 0 ||
    !positionsAreValid ||
    result.accepted_value_increases <
      definition.minimumAcceptedValueIncreaseCount ||
    result.accepted_value_decreases <
      definition.minimumAcceptedValueDecreaseCount ||
    result.canonical_exposures < definition.minimumCanonicalExposureCount
  ) {
    throw new Error(`Local D1 scenario "${scenario}" failed its invariants.`);
  }
}

function listScenarios(): void {
  console.info("Local D1 seed scenarios:");
  for (const [name, definition] of Object.entries(LocalSeedScenarios)) {
    console.info(`  ${name.padEnd(16)} ${definition.description}`);
  }
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return (
    entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)
  );
}

if (isDirectExecution()) {
  const mode = process.argv[2];
  if (mode === "list") {
    listScenarios();
  } else {
    const scenario = parseLocalSeedScenario(
      process.argv[3] ?? process.env.KEEL_LOCAL_SCENARIO,
    );
    if (mode === "ensure") {
      prepareLocalSeedScenario({ scenario });
    } else if (mode === "reset") {
      prepareLocalSeedScenario({ forceReset: true, scenario });
    } else if (mode === "migrate") {
      const persistRoot = resolveLocalScenarioPersistRoot(scenario);
      migrateScenario(persistRoot, repositoryRoot);
    } else if (mode === "check") {
      checkScenario(scenario);
    } else {
      throw new Error(
        "Usage: local-seed-scenarios.ts <list|ensure|reset|migrate|check> [scenario]",
      );
    }
  }
}
