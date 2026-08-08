import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const acceptanceRoot = resolve(process.cwd(), ".keel-local/acceptance");
const d1Directory = resolve(acceptanceRoot, "v3/d1/miniflare-D1DatabaseObject");
const databaseFiles = readdirSync(d1Directory).filter((name) =>
  /^[a-f0-9]{64}\.sqlite$/u.test(name),
);
if (databaseFiles.length !== 1) {
  throw new Error("Expected exactly one disposable acceptance D1 database.");
}

const financialTables = [
  "asset_lots",
  "marks",
  "goals",
  "goal_versions",
  "scenarios",
  "scenario_assumptions",
  "forecast_snapshots",
  "company_forecasts",
  "liquidity_curves",
  "actual_liquidity_events",
  "review_decisions",
  "evidence_applications",
] as const;

const database = new DatabaseSync(resolve(d1Directory, databaseFiles[0]!), {
  readOnly: true,
});
try {
  const financialHashes = Object.fromEntries(
    financialTables.map((table) => {
      const rows = database.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
      return [
        table,
        createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
      ];
    }),
  );
  const evidenceCounts = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM portfolio_watch_sources) AS sources,
         (SELECT COUNT(*) FROM portfolio_watch_source_verification_events) AS verificationEvents,
         (SELECT COUNT(*) FROM public_source_observations) AS observations,
         (SELECT COUNT(*) FROM source_documents) AS sourceDocuments,
         (SELECT COUNT(*) FROM evidence_events WHERE status = 'pending_review') AS pendingEvidence,
         (SELECT COUNT(*) FROM evidence_claims
          WHERE field_path = 'company_event.financing_terms') AS financingClaims`,
    )
    .get();
  const r2BlobDirectory = resolve(
    acceptanceRoot,
    "v3/r2/keel-local-private-documents/blobs",
  );
  const r2Blobs = existsSync(r2BlobDirectory)
    ? readdirSync(r2BlobDirectory).length
    : 0;

  console.info(
    JSON.stringify({ evidenceCounts, financialHashes, r2Blobs }, null, 2),
  );
} finally {
  database.close();
}
