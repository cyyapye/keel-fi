import {
  effectivePositionValuation,
  PurchaseReceiptSchema,
} from "@keel/domain/position-purchases";
import { z } from "zod";
import {
  baselineRow,
  debtRow,
  goalRow,
  planRow,
  mark,
  marksPage,
} from "./contract";
import { DEBT_WINDOW, GOAL_PAGE, type Records } from "./outlook";

export async function readRecords(
  db: D1Database,
  household: string,
  after: number,
): Promise<Records> {
  // One D1 batch observes one SQLite snapshot, including the saved goal forecasts.
  const [baselines, plans, goals, decisions] = await db.batch([
    db
      .prepare(
        `SELECT id,created_at recordedAt,source_observed_at sourceObservedAt,source_revision sourceRevision,
      fi_eligible_liquid_minor liquidMinor,private_paper_value_minor privatePaperMinor,unknown_value_count unknownPositions,
      unknown_cash_account_count unknownCashAccounts,potential_duplicate_count potentialDuplicates, position_count positionCount
      FROM portfolio_baselines WHERE household_id=? ORDER BY created_at DESC,rowid DESC LIMIT 2`,
      )
      .bind(household),
    db
      .prepare(
        `SELECT p.id,p.effective_date effectiveAt,p.fi_eligible_liquid_minor liquidMinor,
      p.protected_cash_floor_minor floorMinor,p.household_burn_monthly_minor householdBurnMinor,p.business_burn_monthly_minor businessBurnMinor
      FROM scenarios s JOIN cash_flow_plans p ON p.scenario_id=s.id AND p.household_id=s.household_id
      WHERE s.household_id=? AND s.name='FI Underwriting' AND s.archived_at IS NULL
      ORDER BY p.effective_date DESC LIMIT 1`,
      )
      .bind(household),
    db
      .prepare(
        `WITH page AS MATERIALIZED (SELECT rowid cursor,id,household_id,is_primary,archived_at
      FROM goals WHERE household_id=? AND rowid>? ORDER BY rowid LIMIT ?)
      SELECT g.cursor,g.id goalId,g.is_primary primaryGoal,g.archived_at archivedAt,
      v.id versionId,v.name,v.metric_key metric,v.target_unit unit,v.target_value_integer target,
      v.target_date targetDate,v.current_value_integer current,v.current_value_source currentSource,v.created_at recordedAt,
      f.id forecastId,f.horizon_date forecastDate,f.middle_value_integer forecastMiddle,f.model_status forecastMode
      FROM page g JOIN goal_versions v ON v.id=(SELECT id FROM goal_versions WHERE goal_id=g.id ORDER BY version DESC LIMIT 1)
      AND v.household_id=g.household_id LEFT JOIN goal_forecast_snapshots f ON f.goal_version_id=v.id AND f.household_id=g.household_id
      ORDER BY g.cursor`,
      )
      .bind(household, after, GOAL_PAGE + 1),
    // Limit the indexed source before joins. Incomplete histories never yield a partial debt total.
    db
      .prepare(
        `WITH page AS MATERIALIZED (SELECT id,household_id,proposal_row_id,decision,decided_at,payment_treatment
      FROM liability_review_decisions WHERE household_id=? ORDER BY decided_at DESC,rowid DESC LIMIT ?)
      SELECT d.id,d.decision,d.decided_at decidedAt,d.payment_treatment treatment,r.natural_key_sha256 key,
      r.balance_minor balanceMinor,r.payment_minor paymentMinor,r.effective_date effectiveDate FROM page d
      JOIN liability_proposal_rows r ON r.id=d.proposal_row_id AND r.household_id=d.household_id`,
      )
      .bind(household, DEBT_WINDOW + 1),
  ]);
  return {
    baselines: z.array(baselineRow).parse(baselines!.results),
    plans: z.array(planRow).parse(plans!.results),
    goals: z.array(goalRow).parse(goals!.results),
    decisions: z.array(debtRow).parse(decisions!.results),
  };
}

const markRow = mark
  .omit({
    sourceChangedSinceBaseline: true,
    reviewedValuation: true,
    latestPublicSignal: true,
    publicSignalScope: true,
  })
  .extend({
    receipt: z.string().nullable(),
    companyId: z.string().nullable(),
    observationId: z.string().nullable(),
    title: z.string().nullable(),
    publishedAt: z.string().nullable(),
    sourceUrl: z.string().nullable(),
  });
export async function readMarks(
  db: D1Database,
  household: string,
  baselineId: string,
  after: string,
) {
  const [base, rows] = await db.batch([
    db
      .prepare(
        "SELECT source_revision revision FROM portfolio_baselines WHERE id=? AND household_id=?",
      )
      .bind(baselineId, household),
    db
      .prepare(
        `WITH page AS MATERIALIZED (
      SELECT item.* FROM portfolio_baselines b CROSS JOIN portfolio_baseline_items item
      WHERE b.id=? AND b.household_id=? AND item.baseline_id=b.id AND item.household_id=b.household_id AND item.position_id>?
      ORDER BY item.position_id LIMIT 51
    ), mapped AS MATERIALIZED (
      SELECT i.*, (SELECT CASE WHEN count(*)=1 THEN min(company_id) END FROM
        (SELECT e.company_id FROM holding_position_exposure_heads m CROSS JOIN canonical_exposures e
         WHERE m.position_id=i.position_id AND m.household_id=i.household_id AND m.status='active'
         AND e.id=m.exposure_id AND e.household_id=i.household_id LIMIT 2)) companyId
      FROM page i
    )
    SELECT i.position_id positionId,p.legal_vehicle_name name,i.classification,i.provider,i.value_minor baselineValueMinor,
      i.snapshot_id baselineSnapshotId,i.observed_at baselineObservedAt,s.id latestSnapshotId,s.source_document_id latestSourceDocumentId,
      s.observed_at latestObservedAt,s.unrealized_value_minor latestReportedUnrealizedMinor,s.provider_status latestProviderStatus,
      q.id acceptedQuoteId,q.price_micros acceptedPriceMicros,q.price_date priceDate,q.share_class shareClass,
      pr.receipt_json receipt,i.companyId,o.id observationId,o.source_title title,o.published_at publishedAt,o.source_url sourceUrl
    FROM mapped i JOIN holding_positions p ON p.id=i.position_id AND p.household_id=i.household_id
    LEFT JOIN holding_import_application_heads a ON a.position_id=p.id
    LEFT JOIN holding_position_snapshots s ON s.id=a.snapshot_id AND s.household_id=i.household_id
    LEFT JOIN holding_purchase_heads ph ON ph.position_id=p.id AND ph.household_id=i.household_id
    LEFT JOIN holding_purchase_reviews pr ON pr.id=ph.review_id AND pr.household_id=i.household_id
    LEFT JOIN holding_price_source_heads h ON h.source_position_id=p.id AND h.household_id=i.household_id
    LEFT JOIN holding_price_quotes q ON q.id=h.quote_id AND q.household_id=i.household_id
    LEFT JOIN public_source_observations o ON o.id=(SELECT id FROM public_source_observations obs INDEXED BY public_source_observations_company_idx
      WHERE obs.company_id=i.companyId AND obs.household_id=i.household_id ORDER BY obs.published_at DESC,obs.rowid DESC LIMIT 1)
    ORDER BY i.position_id`,
      )
      .bind(baselineId, household, after),
  ]);
  if (!base!.results.length) return null;
  const page = z.array(markRow).parse(rows!.results);
  return marksPage.parse({
    version: "1",
    baselineId,
    sourceRevision: z.object({ revision: z.string() }).parse(base!.results[0])
      .revision,
    positions: page.slice(0, 50).map((r) => {
      const receipt = r.receipt
        ? PurchaseReceiptSchema.parse(JSON.parse(r.receipt))
        : null;
      const value = r.latestSnapshotId
        ? effectivePositionValuation(receipt, r.latestSnapshotId)
        : null;
      return {
        ...r,
        reviewedValuation:
          value && receipt
            ? {
                receiptId: receipt.id,
                source: value.sourceLabel,
                origin: value.origin,
                amountMinor: value.valueMinor,
                effectiveDate: value.effectiveDate ?? null,
                carry: value.carryStatus,
                evidenceId: value.sourceEvidenceId ?? value.watchEvidenceId,
              }
            : null,
        sourceChangedSinceBaseline:
          r.latestSnapshotId !== null &&
          r.latestSnapshotId !== r.baselineSnapshotId,
        publicSignalScope: r.companyId
          ? "single_mapped_company"
          : "unmapped_or_multiple_companies",
        latestPublicSignal: r.observationId
          ? {
              observationId: r.observationId,
              title: r.title,
              publishedAt: r.publishedAt,
              sourceUrl: r.sourceUrl,
            }
          : null,
      };
    }),
    nextAfter: page.length > 50 ? page[49]!.positionId : null,
    emailCoverage: "not_connected_by_this_api",
  });
}
