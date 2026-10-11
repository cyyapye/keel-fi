import { renamedInvestmentImport } from "./renamed-investments";
import { syntheticDigest } from "./cost-fixtures";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "../../packages/database/src/holding-imports";
import { D1InvestmentReviewRepository } from "../../packages/database/src/investment-review";
import { D1PositionLinkRepository } from "../../packages/database/src/position-links";

export const renamedCostSubject = "synthetic-access-subject";
export const renamedCostScaleInput = (
  newName: boolean,
  revision: number,
  rotate = false,
): HoldingImportStageInput => {
  const input = renamedInvestmentImport(
    newName ? "Synthetic Circuit Works" : "Synthetic Circuit Labs",
    revision,
  );
  const key = (i: number) =>
    syntheticDigest(i + (rotate ? 2000 : newName ? 1000 : 100));
  input.rows = Array.from({ length: 120 }, (_, i) => ({
    ...input.rows[0]!,
    rowNumber: i + 2,
    naturalKeySha256: key(i),
    fundName: `Synthetic Circuit SPV ${i}, LP`,
  }));
  input.canonicalScope.rows = input.rows.map((row, i) => ({
    ...input.canonicalScope.rows[0]!,
    sourceRowNumber: row.rowNumber,
    protectedPositionKey: key(i),
  }));
  return input;
};

// Preserve the production import/review operations while keeping synthetic setup
// beside D1. The caller still meters the same read and history holdouts.
export async function seedReviewedRenameCostFixture(database: D1Database) {
  const imports = new D1HoldingImportRepository(database);
  const seed = async (input: HoldingImportStageInput) => {
    const staged = await imports.stageHoldingImport(renamedCostSubject, input);
    if (staged.preview.status !== "applied")
      await imports.applyHoldingImport(renamedCostSubject, staged.preview.id, {
        currency: "USD",
        decisions: staged.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
          rationale: "Synthetic reviewed identity.",
        })),
      });
  };
  await seed(renamedCostScaleInput(false, 1));
  await seed(renamedCostScaleInput(true, 2));
  const links = new D1PositionLinkRepository(database);
  const reviews = new D1InvestmentReviewRepository(database);
  const workspace = await links.workspace(renamedCostSubject);
  const positions = workspace.positions.filter((p) =>
    p.legalVehicleName.startsWith("Synthetic Circuit SPV "),
  );
  let companyId: string | undefined;
  for (const position of positions) {
    const c = await reviews.getContext(renamedCostSubject, position.id);
    const receipt = await reviews.reviewCompany(
      renamedCostSubject,
      position.id,
      {
        requestId: crypto.randomUUID(),
        expectedSnapshotId: c.snapshotId,
        expectedEvidenceRevision: c.evidenceRevision,
        expectedMappingIds: c.mappings.map((m) => m.id),
        company: companyId
          ? { mode: "existing", companyId }
          : { mode: "new", legalName: "Synthetic Circuit Labs" },
        basis: "user_confirmed",
        citation: null,
        reason: null,
      },
    );
    companyId = receipt.companyId;
  }
  const groups = new Map<string, typeof positions>();
  for (const p of positions)
    groups.set(p.legalVehicleName, [
      ...(groups.get(p.legalVehicleName) ?? []),
      p,
    ]);
  const inserts = [...groups.values()].map((group) => {
    const source = group.find(
      (p) => p.reportedExposureName === "Synthetic Circuit Works",
    )!;
    const target = group.find(
      (p) => p.reportedExposureName === "Synthetic Circuit Labs",
    )!;
    return database
      .prepare(
        `INSERT INTO holding_position_link_reviews(id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,prior_id,relationship,state,use_source_value,note,reviewer_user_id,accepted_at,company_renamed,company_name,former_company_name) VALUES(?,'hh_demo',?,?,?,?,NULL,NULL,(SELECT review_id FROM holding_position_link_heads WHERE source_position_id=?),'same_investment','linked',0,'Synthetic reviewed rename','usr_demo','2026-09-20T12:00:00.000Z',1,'Synthetic Circuit Works','Synthetic Circuit Labs')`,
      )
      .bind(
        crypto.randomUUID(),
        source.id,
        target.id,
        source.snapshot.id,
        target.snapshot.id,
        source.id,
      );
  });
  await database.batch(inserts);
  return { reviewedPositions: positions.length, renameLinks: inserts.length };
}
