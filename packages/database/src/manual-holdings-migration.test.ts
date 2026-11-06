import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";
import { LegalDocumentTestD1 } from "../../../scripts/test-support/legal-documents";
import { syntheticWefunderImport } from "../../../scripts/test-support/wefunder-holdings";
import { D1HoldingImportRepository } from "./holding-imports";
import { D1PositionPurchaseRepository } from "./position-purchases";

const migration = readFileSync(
  "packages/database/migrations/0089_manual_holdings.sql",
  "utf8",
);
const priorFiles = readdirSync("packages/database/migrations")
  .filter((name) => name.endsWith(".sql") && name < "0089")
  .sort()
  .map((name) => `packages/database/migrations/${name}`);
function applyMigration(db: DatabaseSync) {
  db.exec("BEGIN");
  try {
    db.exec(migration);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
const normalizeSql = (sql: unknown) =>
  String(sql)
    .split("\n")
    .filter((line) => !/^\s*--/u.test(line))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
    .join("\n");
const databases: DatabaseSync[] = [];
const beforeMigration = () => {
  const db = createSqliteFixture([
    ...priorFiles,
    "packages/database/seed/synthetic.sql",
  ]);
  databases.push(db);
  return db;
};
const clone = (
  db: DatabaseSync,
  table: string,
  sourceId: string,
  values: Record<string, SQLInputValue>,
) => {
  const source = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(sourceId);
  if (!source) throw new Error(`Missing synthetic ${table} row`);
  const columns = Object.keys(source);
  db.prepare(
    `INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
  ).run(
    ...columns.map((column) =>
      Object.hasOwn(values, column) ? values[column]! : source[column]!,
    ),
  );
};
async function acceptedProviderPosition(db: DatabaseSync) {
  const repository = new D1HoldingImportRepository(
    new LegalDocumentTestD1(db).asD1(),
  );
  const input = await syntheticWefunderImport({
    count: 1,
    legalName: "Synthetic Migration SPV I",
  });
  const staged = await repository.stageHoldingImport(
    "synthetic-access-subject",
    input,
  );
  await repository.applyHoldingImport(
    "synthetic-access-subject",
    staged.preview.id,
    {
      currency: "USD",
      decisions: staged.preview.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
        rationale: "Accepted synthetic migration fixture.",
      })),
    },
  );
  const row = db
    .prepare(
      `SELECT a.position_id, a.snapshot_id, a.import_row_id, i.source_document_id, i.id import_id
    FROM holding_import_applications a JOIN holding_import_rows r ON r.id=a.import_row_id
    JOIN holding_imports i ON i.id=r.import_id WHERE i.id=?`,
    )
    .get(staged.preview.id);
  if (
    !row ||
    typeof row.position_id !== "string" ||
    typeof row.snapshot_id !== "string" ||
    typeof row.import_row_id !== "string" ||
    typeof row.source_document_id !== "string" ||
    typeof row.import_id !== "string"
  )
    throw new Error("Missing accepted synthetic holding");
  return {
    positionId: row.position_id,
    snapshotId: row.snapshot_id,
    rowId: row.import_row_id,
    documentId: row.source_document_id,
    importId: row.import_id,
  };
}
function insertBaseline(
  db: DatabaseSync,
  position: Awaited<ReturnType<typeof acceptedProviderPosition>>,
) {
  const base = db
    .prepare(
      "SELECT id,version FROM forecast_snapshots WHERE scenario_id='scn_fi' ORDER BY version DESC LIMIT 1",
    )
    .get();
  if (!base || typeof base.id !== "string" || typeof base.version !== "number")
    throw new Error("Missing synthetic forecast");
  clone(db, "forecast_snapshots", base.id, {
    id: "snap_manual_migration",
    input_hash: "synthetic-manual-migration-forecast",
    version: base.version + 1,
    trigger: "Portfolio baseline",
  });
  db.prepare(
    `INSERT INTO portfolio_baselines (
    id,household_id,source_revision,source_observed_at,position_count,public_market_value_minor,private_paper_value_minor,
    unknown_value_count,potential_duplicate_count,prior_fi_eligible_liquid_minor,fi_eligible_liquid_minor,
    base_forecast_snapshot_id,cash_flow_plan_id,forecast_snapshot_id,goal_version_id,change_note,created_by_user_id,created_at,immutable)
    VALUES ('baseline_manual_migration','hh_demo',?,'2026-08-20T00:00:00.000Z',1,0,0,1,0,182500000,182500000,?,'cf_fi','snap_manual_migration',NULL,'Synthetic migration preservation.','usr_demo','2026-09-01T12:00:00.000Z',1)`,
  ).run("a".repeat(64), base.id);
  db.prepare(
    `INSERT INTO portfolio_baseline_items (id,household_id,baseline_id,position_id,snapshot_id,provider,classification,value_minor,value_state,observed_at,duplicate_key,created_at)
    VALUES ('baseline_item_manual_migration','hh_demo','baseline_manual_migration',?,?,'wefunder','private_paper',NULL,'not_reported','2026-08-20T00:00:00.000Z',NULL,'2026-09-01T12:00:00.000Z')`,
  ).run(position.positionId, position.snapshotId);
}
function tableRows(db: DatabaseSync, table: string) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
}
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

describe("manual holdings migration", () => {
  it("preserves accepted snapshots, reviews, baseline history and every prior schema object", async () => {
    const db = beforeMigration();
    const position = await acceptedProviderPosition(db);
    const purchases = new D1PositionPurchaseRepository(
      new LegalDocumentTestD1(db).asD1(),
    );
    await purchases.acceptValuation(
      "synthetic-access-subject",
      position.positionId,
      {
        expectedSnapshotId: position.snapshotId,
        expectedReceiptId: null,
        method: "total",
        record: {
          id: "synthetic-migration-estimate",
          origin: "judgment",
          totalMinor: 140000,
          priceMicros: null,
          effectiveDate: "2026-08-21",
          priceDate: null,
          shareClass: null,
          carryStatus: "unknown",
          sourceLabel: "Synthetic estimate",
          sourceUrl: null,
          sourceEvidenceId: null,
          sourcePositionId: null,
          sourceCapturedAt: null,
          watchEvidenceId: null,
        },
      },
    );
    insertBaseline(db, position);
    const tables = [
      "source_documents",
      "holding_imports",
      "holding_import_rows",
      "holding_positions",
      "holding_position_snapshots",
      "holding_import_row_decisions",
      "holding_import_applications",
      "holding_purchase_reviews",
      "portfolio_baselines",
      "portfolio_baseline_items",
      "forecast_snapshots",
    ];
    const previous = new Map(
      tables.map((table) => [table, tableRows(db, table)]),
    );
    const schemaObjects = () =>
      db
        .prepare(
          "SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
    const schema = schemaObjects();
    applyMigration(db);
    for (const table of tables)
      expect(tableRows(db, table), table).toEqual(previous.get(table));
    // Read the catalogue once per frontier. Preparing a separate name lookup
    // for each old object repeatedly scans sqlite_master.
    const currentByIdentity = new Map(
      schemaObjects().map((item) => [
        `${String(item.type)}:${String(item.name)}`,
        item,
      ]),
    );
    for (const item of schema) {
      const current = currentByIdentity.get(
        `${String(item.type)}:${String(item.name)}`,
      );
      if (!current)
        throw new Error(`Missing prior schema object: ${String(item.name)}`);
      if (
        item.sql === current.sql &&
        item.name !== "holding_purchase_review_guard" &&
        item.name !== "holding_position_link_guard"
      )
        continue;
      let expectedSql = normalizeSql(item.sql);
      if (item.name === "holding_purchase_review_guard")
        expectedSql = expectedSql.replace(
          "p.position_kind='spv_interest' AND p.currency='USD'",
          "(p.position_kind='spv_interest' OR (p.provider='manual' AND p.position_kind IN ('direct','fund_interest'))) AND p.currency='USD'",
        );
      if (item.name === "holding_position_link_guard")
        expectedSql = expectedSql
          .replaceAll(
            "('angellist','tokenfolio','sydecar','wefunder')",
            "('angellist','tokenfolio','sydecar','wefunder','manual')",
          )
          .replace(
            "AND t.position_kind='spv_interest'",
            "AND (t.position_kind='spv_interest' OR t.provider='manual')",
          );
      if (
        ![
          "holding_import_rows",
          "holding_position_snapshots",
          "portfolio_baseline_items",
        ].includes(String(item.name))
      )
        expect(
          { ...current, sql: normalizeSql(current.sql) },
          String(item.name),
        ).toEqual({ ...item, sql: expectedSql });
    }
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() =>
      db
        .prepare(
          "UPDATE holding_position_snapshots SET invested_minor=0 WHERE id=?",
        )
        .run(position.snapshotId),
    ).toThrow("immutable");
    expect(() =>
      db
        .prepare(
          "DELETE FROM portfolio_baseline_items WHERE id='baseline_item_manual_migration'",
        )
        .run(),
    ).toThrow("immutable");
    expect(() =>
      db.prepare("UPDATE holding_purchase_reviews SET receipt_json='{}'").run(),
    ).toThrow("immutable");
  });

  it("keeps manual identity under a genuine manual owner and advances only its recorded version head", async () => {
    const db = beforeMigration();
    const position = await acceptedProviderPosition(db);
    applyMigration(db);
    const oldScope = db
      .prepare(
        `SELECT c.id container_id,c.connection_id,cv.id container_version_id,iv.id connection_version_id,
      ownership.id ownership_id,cv.display_label owner_label FROM holding_position_ownerships ownership
      JOIN ownership_containers c ON c.id=ownership.container_id
      JOIN ownership_container_versions cv ON cv.container_id=c.id
      JOIN investment_connection_versions iv ON iv.connection_id=c.connection_id
      WHERE ownership.position_id=? AND cv.version=1 AND iv.version=1`,
      )
      .get(position.positionId);
    if (!oldScope) throw new Error("Missing synthetic owner scope");
    const key = createHash("sha256")
      .update("synthetic-manual-migration-identity")
      .digest("hex");
    clone(db, "source_documents", position.documentId, {
      id: "doc_manual_identity",
      sha256: key,
      content_type: "application/json",
    });
    clone(db, "holding_positions", position.positionId, {
      id: "position_manual_identity",
      provider: "manual",
      position_fingerprint: key,
    });
    clone(db, "holding_position_ownerships", String(oldScope.ownership_id), {
      id: "ownership_manual_template",
      position_id: "position_manual_identity",
      protected_position_key: key,
      association_basis: "manual",
    });
    clone(
      db,
      "investment_connection_versions",
      String(oldScope.connection_version_id),
      {
        id: "template_mislabeled_manual",
        version: 2,
        supersedes_version_id: oldScope.connection_version_id!,
        institution_key: "manual",
        recorded_at: "2026-09-01T12:00:00.000Z",
      },
    );
    const identity =
      db.prepare(`INSERT INTO manual_holding_identity_versions (id,household_id,position_id,container_id,
      legal_vehicle_name,owner_label,position_kind,opened_on,classification,version,prior_id,source_document_id,
      recorded_by_user_id,recorded_at,immutable,prior_company_mapping_ids_json) VALUES (?,'hh_demo','position_manual_identity',?,? ,?,'spv_interest',NULL,'private_paper',?,?,'doc_manual_identity','usr_demo','2026-09-01T12:00:00.000Z',1,'[]')`);
    expect(() =>
      identity.run(
        "identity_false_manual",
        oldScope.container_id!,
        "Synthetic Manual Identity",
        oldScope.owner_label!,
        1,
        null,
      ),
    ).toThrow("manual holding identity provenance mismatch");
    clone(db, "investment_connections", String(oldScope.connection_id), {
      id: "connection_manual_identity",
      protected_source_key: key,
    });
    clone(
      db,
      "investment_connection_versions",
      String(oldScope.connection_version_id),
      {
        id: "connection_manual_identity_v1",
        connection_id: "connection_manual_identity",
        institution_key: "manual",
        institution_label: "Manual holdings",
      },
    );
    clone(db, "ownership_containers", String(oldScope.container_id), {
      id: "container_manual_identity",
      connection_id: "connection_manual_identity",
      protected_account_key: key,
    });
    clone(
      db,
      "ownership_container_versions",
      String(oldScope.container_version_id),
      {
        id: "container_manual_identity_v1",
        container_id: "container_manual_identity",
      },
    );
    clone(db, "holding_position_ownerships", "ownership_manual_template", {
      id: "ownership_manual_genuine",
      container_id: "container_manual_identity",
      version: 2,
      supersedes_ownership_id: "ownership_manual_template",
    });
    identity.run(
      "identity_manual_v1",
      "container_manual_identity",
      "Synthetic Manual Identity",
      oldScope.owner_label!,
      1,
      null,
    );
    identity.run(
      "identity_manual_v2",
      "container_manual_identity",
      "Synthetic Manual Identity Revised",
      oldScope.owner_label!,
      2,
      "identity_manual_v1",
    );
    expect(
      db
        .prepare(
          "SELECT version_id FROM manual_holding_identity_heads WHERE position_id='position_manual_identity'",
        )
        .get(),
    ).toEqual({ version_id: "identity_manual_v2" });
    expect(() =>
      identity.run(
        "identity_manual_stale",
        "container_manual_identity",
        "Synthetic Stale Identity",
        oldScope.owner_label!,
        2,
        "identity_manual_v1",
      ),
    ).toThrow("manual holding identity stale");
    expect(() =>
      db
        .prepare(
          "UPDATE manual_holding_identity_heads SET version_id='identity_manual_v1' WHERE position_id='position_manual_identity'",
        )
        .run(),
    ).toThrow("manual holding identity head mismatch");
    expect(() =>
      db
        .prepare(
          "UPDATE manual_holding_identity_versions SET legal_vehicle_name='Synthetic forged update'",
        )
        .run(),
    ).toThrow("immutable");
    expect(() =>
      db
        .prepare(
          "DELETE FROM manual_holding_identity_versions WHERE id='identity_manual_v1'",
        )
        .run(),
    ).toThrow("immutable");
    db.prepare(
      `INSERT INTO canonical_exposures (id,household_id,exposure_kind,canonical_name,protected_identity_key,
      company_id,resolution_method,evidence_sha256,created_by_user_id,created_at,immutable)
      VALUES ('exposure_manual_mapping','hh_demo','unresolved','Synthetic Mapping A',NULL,NULL,'unresolved',?,'usr_demo','2026-09-01T12:00:00.000Z',1)`,
    ).run(key);
    db.prepare(
      `INSERT INTO holding_position_exposure_mappings (id,household_id,position_id,exposure_id,relationship_kind,
      allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,
      accepted_by_user_id,accepted_at,immutable) VALUES ('mapping_manual_first','hh_demo','position_manual_identity',
      'exposure_manual_mapping','look_through',NULL,'active','review','Synthetic mapping decision',?,'2026-09-01T12:00:00.000Z',1,NULL,'usr_demo','2026-09-01T12:00:00.000Z',1)`,
    ).run(key);
    const advanceIdentity = (
      id: string,
      priorId: string,
      version: number,
      mappingIds: string,
    ) =>
      clone(db, "manual_holding_identity_versions", priorId, {
        id,
        prior_id: priorId,
        version,
        prior_company_mapping_ids_json: mappingIds,
      });
    expect(() =>
      advanceIdentity(
        "identity_manual_mapping_stale",
        "identity_manual_v2",
        3,
        "[]",
      ),
    ).toThrow("manual holding company mappings stale");
    expect(() =>
      advanceIdentity(
        "identity_manual_mapping_duplicate",
        "identity_manual_v2",
        3,
        '["mapping_manual_first","mapping_manual_first"]',
      ),
    ).toThrow("manual holding mapping precondition malformed");
    expect(() =>
      advanceIdentity(
        "identity_manual_mapping_type",
        "identity_manual_v2",
        3,
        "[1]",
      ),
    ).toThrow("manual holding mapping precondition malformed");
    advanceIdentity(
      "identity_manual_v3",
      "identity_manual_v2",
      3,
      '["mapping_manual_first"]',
    );
    clone(db, "holding_position_exposure_mappings", "mapping_manual_first", {
      id: "mapping_manual_second",
      version: 2,
      supersedes_mapping_id: "mapping_manual_first",
    });
    expect(() =>
      advanceIdentity(
        "identity_manual_mapping_raced",
        "identity_manual_v3",
        4,
        '["mapping_manual_first"]',
      ),
    ).toThrow("manual holding company mappings stale");
    advanceIdentity(
      "identity_manual_v4",
      "identity_manual_v3",
      4,
      '["mapping_manual_second"]',
    );
    clone(db, "holding_position_exposure_mappings", "mapping_manual_second", {
      id: "mapping_manual_withdrawn",
      version: 3,
      supersedes_mapping_id: "mapping_manual_second",
      status: "withdrawn",
    });
    advanceIdentity("identity_manual_v5", "identity_manual_v4", 5, "[]");
    const plan = db
      .prepare(
        `EXPLAIN QUERY PLAN SELECT mapping_id FROM holding_position_exposure_heads INDEXED BY holding_exposure_heads_current_position_idx
      WHERE household_id='hh_demo' AND position_id='position_manual_identity' AND status='active'`,
      )
      .all();
    expect(JSON.stringify(plan)).toContain(
      "COVERING INDEX holding_exposure_heads_current_position_idx",
    );
    expect(
      db
        .prepare(
          "SELECT COUNT(*) count FROM manual_holding_identity_versions WHERE position_id='position_manual_identity'",
        )
        .get(),
    ).toEqual({ count: 5 });
    const identityHistorySql = `SELECT id FROM manual_holding_identity_versions
      WHERE household_id='hh_demo' AND position_id='position_manual_identity'
      ORDER BY recorded_at DESC,id DESC LIMIT 2`;
    expect(db.prepare(identityHistorySql).all()).toEqual([
      { id: "identity_manual_v5" },
      { id: "identity_manual_v4" },
    ]);
    expect(
      JSON.stringify(
        db.prepare(`EXPLAIN QUERY PLAN ${identityHistorySql}`).all(),
      ),
    ).toContain("COVERING INDEX manual_holding_identity_versions_history_idx");
    expect(
      db
        .prepare("PRAGMA index_list(manual_holding_submissions)")
        .all()
        .find(
          (entry) => entry.name === "manual_holding_submissions_identity_idx",
        ),
    ).toMatchObject({ unique: 1 });
    const submission = db.prepare(`INSERT INTO manual_holding_submissions (
      submission_id,household_id,request_hash,position_id,snapshot_id,purchase_review_id,
      identity_version_id,declaration_json,created_by_user_id,accepted_at)
      VALUES ('00000000-0000-4000-8000-000000000089','hh_demo',?,'position_manual_identity',?,'missing_purchase_review',?,?,'usr_demo','2026-09-01T12:00:00.000Z')`);
    const invalidCompanySelections: [string, { mode?: string }][] = [
      ["identity_manual_v1", { mode: "unchanged" }],
      ["identity_manual_v1", { mode: "invented" }],
      ["identity_manual_v5", { mode: "invented" }],
      ["identity_manual_v5", {}],
    ];
    for (const [versionId, company] of invalidCompanySelections) {
      expect(() =>
        submission.run(
          key,
          position.snapshotId,
          versionId,
          JSON.stringify({ company }),
        ),
      ).toThrow("manual holding company selection mismatch");
    }
    expect(() =>
      submission.run(
        key,
        position.snapshotId,
        "identity_manual_v5",
        JSON.stringify({ company: { mode: "unchanged" } }),
      ),
    ).toThrow("manual holding submission provenance mismatch");
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("allows manual unknown source amounts while keeping provider rows and snapshots non-null", async () => {
    const db = beforeMigration();
    const position = await acceptedProviderPosition(db);
    applyMigration(db);
    for (const field of [
      "invested_minor",
      "allocation_minor",
      "realized_value_minor",
    ]) {
      expect(() =>
        clone(db, "holding_import_rows", position.rowId, {
          id: `forged_row_${field}`,
          source_row_number: 2,
          [field]: null,
        }),
      ).toThrow("provider holding amounts are required");
      expect(() =>
        clone(db, "holding_position_snapshots", position.snapshotId, {
          id: `forged_snapshot_${field}`,
          [field]: null,
        }),
      ).toThrow("provider snapshot amounts are required");
    }
    clone(db, "source_documents", position.documentId, {
      id: "doc_manual_unknown",
      sha256: createHash("sha256")
        .update("synthetic-manual-migration-unknown")
        .digest("hex"),
      content_type: "application/json",
      file_name: "synthetic-manual.json",
    });
    clone(db, "holding_imports", position.importId, {
      id: "import_manual_unknown",
      source_document_id: "doc_manual_unknown",
      provider: "manual",
      parser_schema: "manual_holding_v1",
    });
    clone(db, "holding_import_rows", position.rowId, {
      id: "row_manual_unknown",
      import_id: "import_manual_unknown",
      invested_minor: null,
      allocation_minor: null,
      realized_value_minor: null,
    });
    clone(db, "holding_positions", position.positionId, {
      id: "position_manual_unknown",
      provider: "manual",
    });
    clone(db, "holding_position_snapshots", position.snapshotId, {
      id: "snapshot_manual_unknown",
      position_id: "position_manual_unknown",
      source_document_id: "doc_manual_unknown",
      source_import_row_id: "row_manual_unknown",
      invested_minor: null,
      allocation_minor: null,
      realized_value_minor: null,
    });
    expect(
      db
        .prepare(
          "SELECT invested_minor,allocation_minor,realized_value_minor FROM holding_position_snapshots WHERE id='snapshot_manual_unknown'",
        )
        .get(),
    ).toEqual({
      invested_minor: null,
      allocation_minor: null,
      realized_value_minor: null,
    });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() =>
      clone(
        db,
        "holding_import_row_decisions",
        String(
          db
            .prepare(
              "SELECT id FROM holding_import_row_decisions WHERE import_row_id=?",
            )
            .get(position.rowId)?.id,
        ),
        {
          id: "forged_manual_policy",
          import_row_id: "row_manual_unknown",
          matched_position_id: "position_manual_unknown",
          decision_source: "policy",
          policy_version: "private-holdings-auto-v1",
        },
      ),
    ).toThrow("manual holding requires a human decision");
  });
});
