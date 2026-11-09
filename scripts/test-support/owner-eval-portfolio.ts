import { D1PortfolioWatchRepository } from "../../packages/database/src/portfolio-watch";
import { D1LiabilitiesRepository } from "../../packages/database/src/liabilities";
import { COST_SUBJECT } from "./cost-fixtures";
import { baselineCostRepositories } from "./portfolio-baseline-cost";

export async function acceptEvalBaseline(db: D1Database) {
  const { baseline } = baselineCostRepositories(db, () => false);
  const state = await baseline.getState(COST_SUBJECT);
  await baseline.confirm(COST_SUBJECT, {
    sourceRevision: state.sourceRevision!,
    baseForecastSnapshotId: state.baseForecastSnapshotId!,
    baseForecastSnapshotVersion: state.baseForecastSnapshotVersion!,
    otherFiEligibleLiquidMinor: 100000,
    duplicateReviewConfirmed: false,
    cashOverlapReviewConfirmed: false,
    changeNote: "Accept the synthetic eval baseline.",
  });
}

export async function reviewEvalDebt(db: D1Database) {
  const liabilities = new D1LiabilitiesRepository(db);
  const proposal = await liabilities.stageManualProposal(COST_SUBJECT, {
    institutionLabel: "Eval lender",
    accountLabel: "Eval loan",
    kind: "mortgage",
    balanceMinor: 100000,
    paymentMinor: 1000,
    interestRatePpm: null,
    nextPaymentDueDate: null,
    isOverdue: false,
    effectiveDate: "2026-09-01",
  });
  await liabilities.applyProposal(COST_SUBJECT, proposal.id, {
    changeNote: "Reviewed synthetic debt already in the plan.",
    decisions: [
      {
        rowId: proposal.rows[0]!.id,
        decision: "accepted",
        paymentTreatment: "already_in_plan",
      },
    ],
  });
}

export async function recordEvalPublicSignal(db: D1Database, pinned: string) {
  // Record one public company event with no SPV valuation or share price.
  const publicSource = await db
    .prepare(
      `SELECT s.id, s.allowed_origin origin
      FROM portfolio_baseline_items i JOIN holding_position_exposure_heads h ON h.position_id=i.position_id AND h.status='active'
      JOIN canonical_exposures e ON e.id=h.exposure_id JOIN portfolio_watch_sources s ON s.company_id=e.company_id
      WHERE i.baseline_id=? ORDER BY i.position_id,s.id LIMIT 1`,
    )
    .bind(pinned)
    .first<{ id: string; origin: string }>();
  if (!publicSource) throw new Error("Missing synthetic public company source");
  await db
    .prepare("UPDATE portfolio_watch_sources SET status='active' WHERE id=?")
    .bind(publicSource.id)
    .run();
  const watch = new D1PortfolioWatchRepository(db);
  const recorded = await watch.recordObservation({
    sourceId: publicSource.id,
    objectKey: "synthetic/eval-company-update",
    contentType: "text/plain",
    byteSize: 100,
    sha256: "d".repeat(64),
    retrievedAt: "2026-09-02T12:00:00Z",
    sourceUrl: publicSource.origin + "/news/round",
    sourceTitle: "Synthetic company announces financing",
    publishedAt: "2026-09-02T09:00:00Z",
    eventType: "financing_announced",
    observedFact:
      "The synthetic company announced a round. The release gives no price or SPV terms.",
    modelConfidencePpm: 900000,
    financingFacts: null,
    fingerprint: "e".repeat(64),
  });
  if (!recorded)
    throw new Error("Could not record the synthetic financing announcement");
}
