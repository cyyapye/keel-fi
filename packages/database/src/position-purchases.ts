import {
  AcceptPurchasesSchema,
  SharePriceEvidenceListSchema,
  SharePriceEvidenceSchema,
  PositionValuationEvidenceSchema,
  PurchaseReceiptSchema,
  type AcceptPurchases,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";

export class PositionPurchaseError extends Error {
  constructor(
    public readonly code: "not_found" | "stale" | "unsupported",
    message: string,
  ) {
    super(message);
    this.name = "PositionPurchaseError";
  }
}
export interface PositionPurchaseRepository {
  accept(
    subject: string,
    positionId: string,
    input: AcceptPurchases,
  ): Promise<PurchaseReceipt>;
}
export class D1PositionPurchaseRepository implements PositionPurchaseRepository {
  constructor(private readonly db: D1Database) {}
  async valuationEvidence(subject: string, positionId: string) {
    const prices = await this.evidence(subject, positionId);
    const watch = await this.db
      .prepare(
        `
      SELECT DISTINCT o.id,o.source_title title,o.source_url url,o.published_at publishedAt,o.observed_fact fact
      FROM users u JOIN households h ON h.owner_user_id=u.id
      JOIN holding_position_exposure_heads m ON m.household_id=h.id AND m.position_id=? AND m.status='active'
      JOIN canonical_exposures e ON e.id=m.exposure_id AND e.household_id=h.id
      JOIN public_source_observations o ON o.company_id=e.company_id AND o.household_id=h.id
      WHERE u.access_subject=? ORDER BY o.published_at DESC,o.id DESC LIMIT 10
    `,
      )
      .bind(positionId, subject)
      .all();
    return PositionValuationEvidenceSchema.parse({
      prices,
      watch: watch.results,
    });
  }
  async evidence(subject: string, positionId: string) {
    // Materialize related IDs and their latest applications once. CROSS JOIN
    // keeps D1 from starting at all source history and multiplying legal positions.
    const result = await this.db
      .prepare(
        `
      WITH target AS MATERIALIZED (
        SELECT p.id,p.household_id FROM users u JOIN households h ON h.owner_user_id=u.id
        JOIN holding_positions p ON p.household_id=h.id WHERE u.access_subject=? AND p.id=?
      ), target_exposures AS MATERIALIZED (
        SELECT e.id,e.company_id,e.household_id FROM target t
        CROSS JOIN holding_position_exposure_heads m ON m.position_id=t.id AND m.household_id=t.household_id AND m.status='active'
        JOIN canonical_exposures e ON e.id=m.exposure_id AND e.household_id=t.household_id
      ), related_exposures AS MATERIALIZED (
        SELECT id,household_id FROM target_exposures
        UNION
        SELECT e.id,e.household_id FROM target_exposures t
        CROSS JOIN canonical_exposures e ON e.company_id=t.company_id AND e.household_id=t.household_id
      ), related_ids AS MATERIALIZED (
        SELECT id,household_id FROM target
        UNION
        SELECT m.position_id,m.household_id FROM related_exposures related_exposure
        CROSS JOIN holding_position_exposure_heads m ON m.household_id=related_exposure.household_id AND m.exposure_id=related_exposure.id AND m.status='active'
      ), related AS MATERIALIZED (
        SELECT p.id,p.household_id,p.legal_vehicle_name FROM related_ids related_id
        CROSS JOIN holding_positions p ON p.id=related_id.id AND p.household_id=related_id.household_id
      ), latest AS MATERIALIZED (
        SELECT related_position.*, (SELECT candidate.id FROM holding_import_applications candidate
          JOIN holding_position_snapshots cs ON cs.id=candidate.snapshot_id
          WHERE candidate.position_id=related_position.id
          ORDER BY candidate.applied_at DESC,cs.observed_at DESC,candidate.id DESC LIMIT 1) application_id
        FROM related related_position
        WHERE NOT EXISTS (SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=related_position.id)
      )
      SELECT e.import_row_id id,priced_position.id positionId,priced_position.legal_vehicle_name positionLabel,
        CASE i.provider WHEN 'tokenfolio' THEN 'Tokenfolio' WHEN 'sydecar' THEN 'Sydecar' ELSE i.provider END sourceLabel,
        s.observed_at observedAt,e.evidence_json
      FROM latest priced_position CROSS JOIN holding_import_applications a ON a.id=priced_position.application_id
      CROSS JOIN holding_position_snapshots s ON s.id=a.snapshot_id
      CROSS JOIN holding_import_share_prices e ON e.import_row_id=a.import_row_id AND e.household_id=priced_position.household_id
      CROSS JOIN holding_import_rows r ON r.id=e.import_row_id
      CROSS JOIN holding_imports i ON i.id=r.import_id
      ORDER BY s.observed_at DESC,e.import_row_id LIMIT 120
    `,
      )
      .bind(subject, positionId)
      .all<{
        id: string;
        positionId: string;
        positionLabel: string;
        sourceLabel: string;
        observedAt: string;
        evidence_json: string;
      }>();
    return SharePriceEvidenceListSchema.parse(
      result.results.map(({ evidence_json, ...row }) =>
        SharePriceEvidenceSchema.parse({
          ...row,
          ...(JSON.parse(evidence_json) as Record<string, unknown>),
        }),
      ),
    );
  }
  async accept(
    subject: string,
    positionId: string,
    raw: AcceptPurchases,
  ): Promise<PurchaseReceipt> {
    const input = AcceptPurchasesSchema.parse(raw);
    const position = await this.db
      .prepare(
        `SELECT p.household_id,p.position_kind,p.currency,u.id user_id
      FROM users u JOIN households h ON h.owner_user_id=u.id JOIN holding_positions p ON p.household_id=h.id
      WHERE u.access_subject=? AND p.id=?`,
      )
      .bind(subject, positionId)
      .first<{
        household_id: string;
        position_kind: string;
        currency: string;
        user_id: string;
      }>();
    if (!position)
      throw new PositionPurchaseError("not_found", "Position was not found.");
    if (
      position.position_kind !== "spv_interest" ||
      position.currency !== "USD"
    )
      throw new PositionPurchaseError(
        "unsupported",
        "Purchase details currently support USD SPV positions.",
      );
    const referenced = input.details.lots.filter(
      (lot) => lot.mark?.sourceEvidenceId,
    );
    if (referenced.length) {
      const evidence = await this.evidence(subject, positionId);
      for (const lot of referenced) {
        const mark = lot.mark!;
        const source = evidence.find(
          (item) => item.id === mark.sourceEvidenceId,
        );
        if (
          !source ||
          source.markMicros !== mark.priceMicros ||
          (source.markDate !== null &&
            source.markDate !== mark.effectiveDate) ||
          mark.comparableConfirmed !== true ||
          (source.shareClass !== null &&
            source.shareClass.toLowerCase() !== lot.shareClass?.toLowerCase())
        )
          throw new PositionPurchaseError(
            "stale",
            "The selected price changed or needs comparability confirmation. Reload its evidence.",
          );
      }
    }
    const receipt = PurchaseReceiptSchema.parse({
      id: crypto.randomUUID(),
      positionId,
      snapshotId: input.expectedSnapshotId,
      currency: position.currency,
      details: input.details,
      acceptedAt: new Date().toISOString(),
    });
    try {
      await this.db
        .prepare(
          `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .bind(
          receipt.id,
          position.household_id,
          positionId,
          receipt.snapshotId,
          input.expectedReceiptId,
          JSON.stringify(receipt),
          position.user_id,
          receipt.acceptedAt,
        )
        .run();
    } catch (error) {
      if (
        error instanceof Error &&
        /purchase (?:review stale|snapshot stale|provenance mismatch|price evidence stale)/u.test(
          error.message,
        )
      )
        throw new PositionPurchaseError(
          "stale",
          "The position or purchase details changed. Reload and review again.",
        );
      throw error;
    }
    return receipt;
  }
}
