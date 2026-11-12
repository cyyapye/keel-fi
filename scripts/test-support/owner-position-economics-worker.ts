import { z } from "zod";
import { D1HoldingImportRepository } from "../../packages/database/src/holding-imports";
import {
  COST_SUBJECT,
  seedCostHoldings,
  syntheticDigest,
} from "./cost-fixtures";
import { publicInventoryCostInput } from "./public-inventory-cost-worker";

// Keep production ingestion/acceptance beside real D1. The host still executes
// and measures every HTTP/MCP read; setup need not cross the proxy per statement.
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const { round } = z
      .strictObject({ round: z.union([z.literal(0), z.literal(1)]) })
      .parse(await request.json());
    const db = env.DB;
    if (round === 0) {
      await seedCostHoldings(db);
      await db.batch([
        db.prepare(`INSERT INTO investment_connections(id,household_id,adapter_type,protected_source_key,created_by_user_id,created_at,immutable)
          VALUES ('synthetic_public_migration_hh_demo','hh_demo','plaid-investments','${"a".repeat(64)}','usr_demo','2026-08-01T12:00:00.000Z',1)`),
        db.prepare(`INSERT INTO investment_connection_versions(id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
          VALUES ('synthetic-public-v1','hh_demo','synthetic_public_migration_hh_demo',1,'synthetic_public','Synthetic Brokerage','active','synthetic-secret-reference',NULL,'usr_demo','2026-08-01T12:00:00.000Z',1)`),
      ]);
    } else {
      await db.batch([
        db.prepare(
          "INSERT INTO users(id,access_subject,email,display_name,created_at) VALUES('economics-other-user','synthetic-economics-other','economics-other@synthetic.invalid','Synthetic other owner','2026-08-01')",
        ),
        db.prepare(
          "INSERT INTO households(id,owner_user_id,name,base_currency,created_at) VALUES('economics-other-household','economics-other-user','Synthetic other household','USD','2026-08-01')",
        ),
      ]);
      await seedCostHoldings(db, "synthetic-economics-other");
    }
    const input = publicInventoryCostInput(round, false);
    delete input.inventoryEvidence;
    input.rows = input.rows.map((row, index) => ({
      ...row,
      securityType: "equity",
      quantityMicros: round === 0 ? 1_000_000 : index === 2 ? 0 : 2_345_678,
      costBasisMinor:
        round === 0 ? 10000 : index === 1 ? null : index === 2 ? 0 : 23456,
      marketValueMinor: index === 2 && round > 0 ? 0 : 34567,
      issues: index === 1 && round > 0 ? ["Cost basis is unavailable."] : [],
    }));
    input.canonicalScope.rows[119] = {
      ...input.canonicalScope.rows[119]!,
      publicExposureIdentityKind: "cusip",
      protectedExposureKey: syntheticDigest(900),
    };
    const imports = new D1HoldingImportRepository(db);
    const staged = await imports.stagePlaidInvestmentsHoldingImport(
      COST_SUBJECT,
      input,
    );
    await imports.applyHoldingImport(COST_SUBJECT, staged.preview.id, {
      currency: "USD",
      decisions: staged.preview.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
        rationale: "Accept synthetic position economics.",
      })),
    });
    return Response.json({ round, complete: true });
  },
};
