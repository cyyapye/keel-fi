import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { canonicalizeCompanyWebsite } from "../packages/connectors/src/index";

export const LOCAL_ACCEPTANCE_PERSIST_DIRECTORY = ".keel-local/acceptance";

export const CanonicalLocalCompanies = [
  {
    companyId: "co_northstar",
    legalName: "Northstar Robotics",
    websiteHost: "northstar-robotics.example",
  },
  {
    companyId: "co_harbor",
    legalName: "Harbor Health Systems",
    websiteHost: "harbor-health.example",
  },
  {
    companyId: "co_lattice",
    legalName: "Lattice Grove Energy",
    websiteHost: "lattice-grove.example",
  },
] as const;

const CanonicalCompanyIdSchema = z.enum(
  CanonicalLocalCompanies.map((company) => company.companyId) as [
    (typeof CanonicalLocalCompanies)[number]["companyId"],
    ...(typeof CanonicalLocalCompanies)[number]["companyId"][],
  ],
);

const AcceptanceCompanySchema = z
  .object({
    companyId: CanonicalCompanyIdSchema,
    legalName: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((value) => !/[\r\n]/.test(value)),
    homepageUrl: z.string().trim().min(1).max(2_048),
  })
  .strict();

const AcceptanceProfileInputSchema = z
  .object({
    version: z.literal(1),
    companies: z
      .array(AcceptanceCompanySchema)
      .min(1)
      .max(CanonicalLocalCompanies.length),
  })
  .strict();

export type AcceptanceCompany = z.infer<typeof AcceptanceCompanySchema>;
export type AcceptanceProfile = {
  version: 1;
  companies: readonly (AcceptanceCompany & { websiteHost: string })[];
};

export function parseAcceptanceProfile(input: unknown): AcceptanceProfile {
  const parsed = AcceptanceProfileInputSchema.parse(input);
  const byId = new Map(
    parsed.companies.map((company) => [company.companyId, company]),
  );
  if (byId.size !== parsed.companies.length) {
    throw new Error(
      "Acceptance profile may name each synthetic company only once.",
    );
  }

  return {
    version: parsed.version,
    companies: CanonicalLocalCompanies.flatMap((canonical) => {
      const company = byId.get(canonical.companyId);
      if (company === undefined) {
        return [];
      }
      return [
        {
          ...company,
          websiteHost: canonicalizeCompanyWebsite({
            companyId: company.companyId,
            homepageUrl: company.homepageUrl,
          }).approvedWebsiteHost,
        },
      ];
    }),
  };
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildApplySql(profile: AcceptanceProfile): string {
  const companyUpdates = profile.companies
    .map(
      (company) => `
        UPDATE companies
        SET legal_name = ${sqlLiteral(company.legalName)},
            website_host = ${sqlLiteral(company.websiteHost)},
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ${sqlLiteral(company.companyId)}
          AND household_id = 'hh_demo';
      `,
    )
    .join("\n");

  return `
    PRAGMA foreign_keys = ON;
    BEGIN IMMEDIATE;

    -- The canonical Inbox examples would otherwise inherit the runtime real
    -- company names. Remove only those three pending demo proposals after
    -- proving no decision, application, or public observation depends on them.
    CREATE TABLE acceptance_profile_guard (
      valid INTEGER NOT NULL CHECK (valid = 1)
    );
    INSERT INTO acceptance_profile_guard (valid)
    SELECT CASE WHEN
      (
        SELECT COUNT(*) FROM evidence_events
        WHERE id IN (
          'evt_northstar_round',
          'evt_harbor_distribution',
          'evt_lattice_delay'
        )
          AND household_id = 'hh_demo'
          AND status = 'pending_review'
      ) = 3
      AND (
        SELECT COUNT(*) FROM review_decisions
        WHERE evidence_event_id IN (
          'evt_northstar_round',
          'evt_harbor_distribution',
          'evt_lattice_delay'
        )
      ) = 0
      AND (
        SELECT COUNT(*) FROM evidence_applications
        WHERE evidence_event_id IN (
          'evt_northstar_round',
          'evt_harbor_distribution',
          'evt_lattice_delay'
        )
      ) = 0
      AND (
        SELECT COUNT(*) FROM public_source_observations
        WHERE evidence_event_id IN (
          'evt_northstar_round',
          'evt_harbor_distribution',
          'evt_lattice_delay'
        )
      ) = 0
    THEN 1 ELSE 0 END;

    DELETE FROM evidence_claims
    WHERE evidence_event_id IN (
      'evt_northstar_round',
      'evt_harbor_distribution',
      'evt_lattice_delay'
    );
    DELETE FROM evidence_events
    WHERE id IN (
      'evt_northstar_round',
      'evt_harbor_distribution',
      'evt_lattice_delay'
    )
      AND household_id = 'hh_demo'
      AND status = 'pending_review';
    DROP TABLE acceptance_profile_guard;

    ${companyUpdates}
    COMMIT;
  `;
}

export function resolveAcceptancePersistRoot(cwd = process.cwd()): string {
  const localStateRoot = resolve(cwd, ".keel-local");
  const acceptanceRoot = resolve(cwd, LOCAL_ACCEPTANCE_PERSIST_DIRECTORY);
  const fromLocalStateRoot = relative(localStateRoot, acceptanceRoot);
  if (
    acceptanceRoot === localStateRoot ||
    fromLocalStateRoot !== "acceptance" ||
    acceptanceRoot === resolve(cwd)
  ) {
    throw new Error(
      "Acceptance persistence root is not the exact local acceptance directory.",
    );
  }
  return acceptanceRoot;
}

export function readAcceptanceProfile(
  environment: NodeJS.ProcessEnv,
  stdin = 0,
): AcceptanceProfile {
  const inline = environment.KEEL_LOCAL_ACCEPTANCE_PROFILE_JSON;
  const useStdin = environment.KEEL_LOCAL_ACCEPTANCE_PROFILE_STDIN === "1";
  if (inline !== undefined && useStdin) {
    throw new Error(
      "Use either the acceptance-profile JSON or stdin, not both.",
    );
  }
  if (inline === undefined && !useStdin) {
    throw new Error(
      "Set KEEL_LOCAL_ACCEPTANCE_PROFILE_JSON or KEEL_LOCAL_ACCEPTANCE_PROFILE_STDIN=1.",
    );
  }

  const raw = inline ?? readFileSync(stdin, "utf8");
  try {
    return parseAcceptanceProfile(JSON.parse(raw) as unknown);
  } catch {
    throw new Error("Acceptance profile input is invalid.");
  }
}

function acceptanceCommandEnvironment(persistRoot: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.KEEL_LOCAL_ACCEPTANCE_PROFILE_JSON;
  delete environment.KEEL_LOCAL_ACCEPTANCE_PROFILE_STDIN;
  return {
    ...environment,
    WRANGLER_LOG_PATH: join(persistRoot, "logs", "wrangler.log"),
  };
}

function runLocalD1(sql: string, persistRoot: string): void {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "keel-acceptance-"));
  const sqlPath = join(temporaryDirectory, "overlay.sql");
  writeFileSync(sqlPath, sql, { encoding: "utf8", mode: 0o600 });
  try {
    const result = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "keel-local",
        "--env",
        "local",
        "--local",
        "--persist-to",
        persistRoot,
        "--config",
        "apps/api/wrangler.jsonc",
        "--file",
        sqlPath,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: acceptanceCommandEnvironment(persistRoot),
      },
    );
    if (result.status !== 0) {
      throw new Error("Local acceptance D1 command failed.");
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function apply(profile: AcceptanceProfile): void {
  const persistRoot = resolveAcceptancePersistRoot();
  clean(persistRoot);
  try {
    mkdirSync(persistRoot, { recursive: true, mode: 0o700 });
    mkdirSync(join(persistRoot, "logs"), { recursive: true, mode: 0o700 });
    const commandEnvironment = acceptanceCommandEnvironment(persistRoot);
    const migration = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "migrations",
        "apply",
        "keel-local",
        "--env",
        "local",
        "--local",
        "--persist-to",
        persistRoot,
        "--config",
        "apps/api/wrangler.jsonc",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: commandEnvironment },
    );
    if (migration.status !== 0) {
      throw new Error("Local acceptance D1 migration failed.");
    }
    const seed = spawnSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "keel-local",
        "--env",
        "local",
        "--local",
        "--persist-to",
        persistRoot,
        "--config",
        "apps/api/wrangler.jsonc",
        "--file",
        "packages/database/seed/synthetic.sql",
      ],
      { cwd: process.cwd(), encoding: "utf8", env: commandEnvironment },
    );
    if (seed.status !== 0) {
      throw new Error("Local acceptance D1 seed failed.");
    }
    runLocalD1(buildApplySql(profile), persistRoot);
  } catch (error) {
    clean(persistRoot);
    throw error;
  }
  console.log(
    `Created a disposable runtime-only acceptance profile for ${profile.companies.length} synthetic ${profile.companies.length === 1 ? "company" : "companies"}.`,
  );
  console.log("Start it with make local-acceptance-dev.");
}

function clean(persistRoot = resolveAcceptancePersistRoot()): void {
  if (existsSync(persistRoot)) {
    rmSync(persistRoot, { recursive: true, force: true });
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
  if (mode === "apply") {
    apply(readAcceptanceProfile(process.env));
  } else if (mode === "restore" || mode === "clean") {
    clean();
    console.log(
      "Removed the disposable local acceptance profile. Default local state was untouched.",
    );
  } else {
    throw new Error("Usage: local-acceptance-profile.ts <apply|restore|clean>");
  }
}
