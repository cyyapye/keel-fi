import {
  AcceptPurchasesSchema,
  InvestmentHistorySchema,
  SharePriceEvidenceListSchema,
  SharePriceEvidenceSchema,
  PositionValuationEvidenceSchema,
  PurchaseReceiptSchema,
  type AcceptPurchases,
  type PurchaseReceipt,
  calculateValuationFromShares,
  valuationSharesKey,
  purchaseFeeSummary,
} from "@keel/domain/position-purchases";
import {
  AcceptValuationSchema,
  type AcceptValuation,
} from "@keel/domain/valuation-record";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";

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
  private async current(subject: string, positionId: string) {
    const row = await this.db
      .prepare(
        `SELECT r.receipt_json FROM users u
      JOIN households h ON h.owner_user_id=u.id
      JOIN holding_purchase_heads head ON head.household_id=h.id AND head.position_id=?
      JOIN holding_purchase_reviews r ON r.id=head.review_id WHERE u.access_subject=?`,
      )
      .bind(positionId, subject)
      .first<{ receipt_json: string }>();
    return row
      ? PurchaseReceiptSchema.parse(JSON.parse(row.receipt_json))
      : null;
  }

  private historyQuery(hasCursor: boolean) {
    const range = hasCursor ? "AND (r.accepted_at,r.id,?) < (?,?,?)" : "";
    return this.db.prepare(`
      WITH owned AS (SELECT p.household_id FROM holding_positions p
        JOIN households h ON h.id=p.household_id
        JOIN users u ON u.id=h.owner_user_id WHERE p.id=? AND u.access_subject=?),
      candidates AS (
        SELECT * FROM (SELECT r.id,r.accepted_at,'investment' AS kind
        FROM holding_purchase_reviews r JOIN owned o ON o.household_id=r.household_id
        WHERE r.position_id=? ${range}
        ORDER BY r.accepted_at DESC,r.id DESC LIMIT 31)
        UNION ALL SELECT * FROM (SELECT r.id,r.accepted_at,'link' AS kind
        FROM holding_position_link_reviews r JOIN owned o ON o.household_id=r.household_id
        WHERE r.source_position_id=? ${range}
        ORDER BY r.accepted_at DESC,r.id DESC LIMIT 31)
        UNION ALL SELECT * FROM (SELECT r.id,r.accepted_at,'link' AS kind
        FROM holding_position_link_reviews r JOIN owned o ON o.household_id=r.household_id
        WHERE r.target_position_id=? ${range}
        ORDER BY r.accepted_at DESC,r.id DESC LIMIT 31)
      ), page AS (SELECT * FROM candidates ORDER BY accepted_at DESC,id DESC,kind DESC LIMIT 31)
      SELECT page.kind,page.id,page.accepted_at,r.receipt_json,
        prior.receipt_json AS previous_json,
        s.legal_vehicle_name AS source_label,t.legal_vehicle_name AS target_label,
        json_object('id',l.id,'sourcePositionId',l.source_position_id,
          'targetPositionId',l.target_position_id,'relationship',l.relationship,
          'state',l.state,'useSourceValue',json(CASE l.use_source_value WHEN 1 THEN 'true' ELSE 'false' END),
          'companyRenamed',json(CASE l.company_renamed WHEN 1 THEN 'true' ELSE 'false' END),
          'companyName',l.company_name,'formerCompanyName',l.former_company_name,
          'note',l.note,'acceptedAt',l.accepted_at) AS link_json
      FROM page
      LEFT JOIN holding_purchase_reviews r ON page.kind='investment' AND r.id=page.id
      LEFT JOIN holding_purchase_reviews prior ON prior.id=r.prior_id
        AND prior.household_id=r.household_id AND prior.position_id=r.position_id
      LEFT JOIN holding_position_link_reviews l ON page.kind='link' AND l.id=page.id
      LEFT JOIN holding_positions s ON s.id=l.source_position_id
      LEFT JOIN holding_positions t ON t.id=l.target_position_id
      ORDER BY page.accepted_at DESC,page.id DESC,page.kind DESC
    `);
  }

  async history(
    subject: string,
    positionId: string,
    cursor?: { date: string; id: string; kind: "investment" | "link" },
  ) {
    // Each indexed branch reads at most one page plus lookahead. Predecessors
    // follow saved identities, including tied timestamps and page boundaries.
    const bindBranch = (kind: string) => [
      positionId,
      ...(cursor ? [kind, cursor.date, cursor.id, cursor.kind] : []),
    ];
    const result = await this.historyQuery(Boolean(cursor))
      .bind(
        positionId,
        subject,
        ...bindBranch("investment"),
        ...bindBranch("link"),
        ...bindBranch("link"),
      )
      .all<{
        kind: "investment" | "link";
        id: string;
        accepted_at: string;
        receipt_json: string | null;
        previous_json: string | null;
        source_label: string | null;
        target_label: string | null;
        link_json: string;
      }>();
    const rows = result.results.slice(0, 30);
    const last = rows.at(-1);
    return InvestmentHistorySchema.parse({
      entries: rows.map((row) =>
        row.kind === "investment"
          ? {
              kind: row.kind,
              receipt: PurchaseReceiptSchema.parse(
                JSON.parse(row.receipt_json!),
              ),
              previous: row.previous_json
                ? PurchaseReceiptSchema.parse(JSON.parse(row.previous_json))
                : null,
            }
          : {
              kind: row.kind,
              receipt: JSON.parse(row.link_json) as unknown,
              sourceLabel: row.source_label,
              targetLabel: row.target_label,
            },
      ),
      next:
        result.results.length > 30 && last
          ? { date: last.accepted_at, id: last.id, kind: last.kind }
          : null,
    });
  }

  async acceptValuation(
    subject: string,
    positionId: string,
    raw: AcceptValuation,
  ) {
    const input = AcceptValuationSchema.parse(raw);
    const prior = await this.current(subject, positionId);
    if ((prior?.id ?? null) !== input.expectedReceiptId)
      throw new PositionPurchaseError(
        "stale",
        "The investment changed. Reload before saving.",
      );
    const record = input.record;
    if (
      [record.effectiveDate, record.priceDate].some(
        (date) => date && date > new Date().toISOString().slice(0, 10),
      )
    )
      throw new PositionPurchaseError(
        "unsupported",
        "A valuation cannot be dated in the future.",
      );
    if (record.sourceEvidenceId || record.watchEvidenceId) {
      const evidence = await this.valuationEvidence(subject, positionId);
      if (record.sourceEvidenceId) {
        const source = evidence.prices.find(
          (p) => p.id === record.sourceEvidenceId,
        );
        if (
          !source ||
          source.positionId !== record.sourcePositionId ||
          source.capturedAt !== record.sourceCapturedAt ||
          source.markMicros !== record.priceMicros ||
          source.markDate !== record.priceDate ||
          source.shareClass !== record.shareClass ||
          (source.positionId !== positionId &&
            (record.origin !== "proxy" || record.totalMinor !== null))
        )
          throw new PositionPurchaseError(
            "stale",
            "This source price changed. Reload the available sources.",
          );
      }
      if (
        record.watchEvidenceId &&
        !evidence.watch.some((w) => w.id === record.watchEvidenceId)
      )
        throw new PositionPurchaseError(
          "stale",
          "This evidence is no longer available for the holding.",
        );
    }
    const details: PurchaseReceipt["details"] = prior?.details ?? {
      investmentTerms: unknownInvestmentTerms(),
      coversPosition: false,
      lots: [],
    };
    const investmentSnapshotId =
      details.investmentSnapshotId ??
      prior?.snapshotId ??
      input.expectedSnapshotId;
    const calculation =
      investmentSnapshotId === input.expectedSnapshotId
        ? calculateValuationFromShares(details, record)
        : null;
    if (
      (input.method === "total" && record.totalMinor === null) ||
      (input.method === "shares" && calculation === null)
    )
      throw new PositionPurchaseError(
        "unsupported",
        "This valuation needs supported, dated shares in Investment.",
      );
    const preserved = [...(details.valuation?.records ?? [])];
    const reported = details.investmentTerms?.reportedValueReview;
    if (
      record.id !== "gp" &&
      reported?.effectiveDate &&
      !preserved.some((r) => r.id === "gp")
    )
      preserved.push({
        id: "gp",
        origin: "gp",
        totalMinor: reported.valueMinor,
        priceMicros: null,
        priceDate: null,
        effectiveDate: reported.effectiveDate,
        shareClass: null,
        carryStatus: reported.carryStatus,
        sourceLabel: reported.sourceLabel,
        sourceUrl: null,
        sourceEvidenceId: null,
        sourcePositionId: null,
        sourceCapturedAt: null,
        watchEvidenceId: null,
      });
    const records = preserved.filter((r) => r.id !== record.id);
    // Source identifiers are bounded; append-only receipts preserve earlier versions.
    if (records.length >= 30)
      throw new PositionPurchaseError(
        "unsupported",
        "Edit an existing valuation source.",
      );
    return this.append(subject, positionId, {
      expectedSnapshotId: input.expectedSnapshotId,
      expectedReceiptId: input.expectedReceiptId,
      expectedTermsId: input.expectedTermsId,
      details: {
        ...details,
        investmentSnapshotId,
        investmentTerms: {
          ...(details.investmentTerms ?? unknownInvestmentTerms()),
          reportedValueReview: null,
        },
        lots: details.lots.map((lot) => ({ ...lot, mark: null })),
        valuation: {
          snapshotId: input.expectedSnapshotId,
          records: [...records, record],
          selected: {
            recordId: record.id,
            method: input.method,
            sharesKey:
              input.method === "shares" ? valuationSharesKey(details) : null,
          },
        },
      },
    });
  }
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
        s.observed_at observedAt,i.created_at capturedAt,e.evidence_json
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
        capturedAt: string;
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
    const prior = await this.current(subject, positionId);
    if ((prior?.id ?? null) !== input.expectedReceiptId)
      throw new PositionPurchaseError(
        "stale",
        "The investment changed. Reload before saving.",
      );
    // A purchase editor cannot overwrite the valuation partition.
    delete input.details.valuation;
    input.details.investmentSnapshotId = input.expectedSnapshotId;
    if (prior?.details.valuation) {
      input.details.valuation = prior.details.valuation;
      input.details.lots = input.details.lots.map((lot) => ({
        ...lot,
        mark: null,
      }));
      if (input.details.investmentTerms)
        input.details.investmentTerms.reportedValueReview = null;
    }
    const feeIds = new Set<string>();
    const lotIds = new Set(input.details.lots.map((l) => l.id));
    for (const lot of input.details.lots) {
      if (!lot.fees) continue;
      for (const fee of lot.fees) {
        if (fee.paymentStatus === "unpaid") fee.treatment = "separate";
        if (
          feeIds.has(fee.id) ||
          fee.coveredLotIds.some((id) => !lotIds.has(id))
        )
          throw new PositionPurchaseError(
            "unsupported",
            "Record each fee once and link it only to this investment's acquisitions.",
          );
        feeIds.add(fee.id);
      }
      if (new Set(lot.fees.map((f) => f.id)).size !== lot.fees.length)
        throw new PositionPurchaseError(
          "unsupported",
          "Fee identifiers must be unique within an acquisition.",
        );
      const fees = purchaseFeeSummary(lot);
      if (lot.feesComplete && !fees)
        throw new PositionPurchaseError(
          "unsupported",
          "Complete the fee basis and prepaid duration.",
        );
      if (fees) {
        const retained =
          lot.grossCashMinor === null
            ? null
            : BigInt(lot.grossCashMinor) -
              BigInt(
                lot.capitalReturn?.status === "received"
                  ? lot.capitalReturn.amountMinor
                  : 0,
              );
        if (retained !== null && BigInt(fees.amountMinor) > retained)
          throw new PositionPurchaseError(
            "unsupported",
            "Upfront fees exceed cash after refunds.",
          );
        // Explicit net-capital bases remain evidence even when the fee is estimated.
        for (const fee of lot.fees)
          if (
            fee.method === "percentage" &&
            fee.basis === "net_capital" &&
            fee.basisMinor === null
          )
            fee.basisMinor = lot.netCapitalMinor;
        lot.upfrontDeductionsMinor = fees.estimated ? null : fees.amountMinor;
        lot.netCapitalMinor =
          fees.estimated || lot.grossCashMinor === null
            ? null
            : Number(
                BigInt(lot.grossCashMinor) -
                  BigInt(
                    lot.capitalReturn?.status === "received"
                      ? lot.capitalReturn.amountMinor
                      : 0,
                  ) -
                  BigInt(fees.amountMinor),
              );
      }
    }
    if (
      prior?.details.valuation?.selected?.method === "shares" &&
      valuationSharesKey(input.details) !== valuationSharesKey(prior.details)
    )
      input.details.valuation = { ...prior.details.valuation, selected: null };
    return this.append(subject, positionId, input);
  }

  private async append(
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
          (mark.proxy
            ? mark.proxy.capturedAt !== source.capturedAt
            : mark.comparableConfirmed !== true) ||
          (source.shareClass !== null &&
            (mark.proxy
              ? source.shareClass.toLowerCase() !==
                mark.shareClass?.toLowerCase()
              : source.shareClass.toLowerCase() !==
                lot.shareClass?.toLowerCase()))
        )
          throw new PositionPurchaseError(
            "stale",
            "The selected price changed or its valuation choice needs review. Reload its evidence.",
          );
      }
    }
    const receipt = PurchaseReceiptSchema.parse({
      supersedesEconomicsTermsId: input.expectedTermsId,
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
        /purchase (?:review stale|snapshot stale|provenance mismatch|price evidence stale|value evidence stale|unified terms downgrade|economics review stale|capital does not reconcile)/u.test(
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
