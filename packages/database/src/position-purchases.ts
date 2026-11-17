import {
  AcceptPurchasesSchema,
  AcceptDistributionsSchema,
  type AcceptDistributions,
  InvestmentHistorySchema,
  SharePriceEvidenceListSchema,
  SharePriceEvidenceSchema,
  PositionValuationEvidenceSchema,
  PurchaseReceiptSchema,
  type AcceptPurchases,
  type PurchaseReceipt,
  calculateValuationFromShares,
  assessValuationFromShares,
  valuationSharesKey,
  purchaseFeeSummary,
} from "@keel/domain/position-purchases";
import {
  AcceptValuationSchema,
  type AcceptValuation,
} from "@keel/domain/valuation-record";
import { D1PriceProxyRepository } from "./price-proxies";
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
  acceptDistributions?(
    subject: string,
    positionId: string,
    input: AcceptDistributions,
  ): Promise<PurchaseReceipt>;
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
        `SELECT r.receipt_json FROM holding_positions p
      JOIN households h ON h.id=p.household_id
      JOIN users u ON u.id=h.owner_user_id
      LEFT JOIN holding_purchase_heads head ON head.household_id=p.household_id AND head.position_id=p.id
      LEFT JOIN holding_purchase_reviews r ON r.id=head.review_id
      WHERE p.id=? AND u.access_subject=?`,
      )
      .bind(positionId, subject)
      .first<{ receipt_json: string | null }>();
    if (!row)
      throw new PositionPurchaseError("not_found", "Position was not found.");
    return row.receipt_json
      ? PurchaseReceiptSchema.parse(JSON.parse(row.receipt_json))
      : null;
  }

  private historyQuery(hasCursor: boolean) {
    const range = hasCursor ? "AND (r.accepted_at,r.id,?) < (?,?,?)" : "";
    const identityRange = hasCursor
      ? "AND (r.recorded_at,r.id,?) < (?,?,?)"
      : "";
    const priorCompanies = `(SELECT json_group_array(json_object('id',company_id,'name',canonical_name)) FROM (
      SELECT e.company_id,e.canonical_name FROM json_each(identity_version.prior_company_mapping_ids_json) ids
      JOIN holding_position_exposure_mappings mapping ON mapping.id=ids.value
      JOIN canonical_exposures e ON e.id=mapping.exposure_id WHERE e.company_id IS NOT NULL ORDER BY e.company_id))`;
    const currentCompanies = `CASE json_extract(identity_submission.declaration_json,'$.company.mode')
      WHEN 'existing' THEN (SELECT json_group_array(json_object('id',company_id,'name',canonical_name)) FROM canonical_exposures
        WHERE household_id=identity_version.household_id AND company_id=json_extract(identity_submission.declaration_json,'$.company.companyId'))
      WHEN 'unassigned' THEN '[]' ELSE ${priorCompanies} END`;
    return this.db.prepare(`
      WITH owned AS MATERIALIZED (SELECT p.household_id,p.id AS position_id FROM holding_positions p
        JOIN households h ON h.id=p.household_id
        JOIN users u ON u.id=h.owner_user_id WHERE p.id=? AND u.access_subject=?),
      candidates AS (
        SELECT * FROM (SELECT r.id,r.accepted_at,'investment' AS kind
        FROM holding_purchase_reviews r
        WHERE r.household_id=(SELECT household_id FROM owned) AND r.position_id=? ${range} AND r.id IS NOT (
          SELECT first_submission.purchase_review_id FROM manual_holding_identity_versions first_identity
          JOIN manual_holding_submissions first_submission ON first_submission.identity_version_id=first_identity.id
          WHERE first_identity.position_id=(SELECT position_id FROM owned) AND first_identity.version=1)
        ORDER BY r.accepted_at DESC,r.id DESC LIMIT 31)
        UNION ALL SELECT * FROM (SELECT r.id,r.accepted_at,'link' AS kind
        FROM holding_position_link_reviews r
        WHERE r.household_id=(SELECT household_id FROM owned) AND r.source_position_id=? ${range}
        ORDER BY r.accepted_at DESC,r.id DESC LIMIT 31)
        UNION ALL SELECT * FROM (SELECT r.id,r.accepted_at,'link' AS kind
        FROM holding_position_link_reviews r
        WHERE r.household_id=(SELECT household_id FROM owned) AND r.target_position_id=? ${range}
        ORDER BY r.accepted_at DESC,r.id DESC LIMIT 31)
        UNION ALL SELECT * FROM (SELECT r.id,r.recorded_at AS accepted_at,'identity' AS kind
        FROM manual_holding_identity_versions r
        WHERE r.household_id=(SELECT household_id FROM owned) AND r.position_id=(SELECT position_id FROM owned) ${identityRange}
        ORDER BY r.recorded_at DESC,r.id DESC LIMIT 31)
      ), page AS (SELECT * FROM candidates ORDER BY accepted_at DESC,id DESC,kind DESC LIMIT 31)
      SELECT page.kind,page.id,page.accepted_at,r.receipt_json,
        prior.receipt_json AS previous_json,
        s.legal_vehicle_name AS source_label,t.legal_vehicle_name AS target_label,
        json_object('id',l.id,'sourcePositionId',l.source_position_id,
          'targetPositionId',l.target_position_id,'relationship',l.relationship,
          'state',l.state,'useSourceValue',json(CASE l.use_source_value WHEN 1 THEN 'true' ELSE 'false' END),
          'companyRenamed',json(CASE l.company_renamed WHEN 1 THEN 'true' ELSE 'false' END),
          'companyName',l.company_name,'formerCompanyName',l.former_company_name,
          'note',l.note,'acceptedAt',l.accepted_at) AS link_json,
        CASE WHEN page.kind='identity' THEN json_object('id',identity_version.id,'acceptedAt',identity_version.recorded_at,'initialInvestment',json(initial_purchase.receipt_json),'value',json_object(
          'name',identity_version.legal_vehicle_name,'kind',identity_version.position_kind,'ownerLabel',identity_version.owner_label,'companies',json(${currentCompanies}))) ELSE NULL END AS identity_json,
        CASE WHEN identity_prior.id IS NULL THEN NULL ELSE json_object('name',identity_prior.legal_vehicle_name,'kind',identity_prior.position_kind,
          'ownerLabel',identity_prior.owner_label,'companies',json(${priorCompanies})) END AS identity_previous_json
      FROM page
      LEFT JOIN holding_purchase_reviews r ON page.kind='investment' AND r.id=page.id
      LEFT JOIN holding_purchase_reviews prior ON prior.id=r.prior_id
        AND prior.household_id=r.household_id AND prior.position_id=r.position_id
      LEFT JOIN holding_position_link_reviews l ON page.kind='link' AND l.id=page.id
      LEFT JOIN holding_positions s ON s.id=l.source_position_id
      LEFT JOIN holding_positions t ON t.id=l.target_position_id
      LEFT JOIN manual_holding_identity_versions identity_version ON page.kind='identity' AND identity_version.id=page.id
      LEFT JOIN manual_holding_identity_versions identity_prior ON identity_prior.id=identity_version.prior_id
      LEFT JOIN manual_holding_submissions identity_submission ON identity_submission.identity_version_id=identity_version.id
      LEFT JOIN holding_purchase_reviews initial_purchase ON identity_version.version=1 AND initial_purchase.id=identity_submission.purchase_review_id
      WHERE EXISTS (SELECT 1 FROM owned)
      ORDER BY page.accepted_at DESC,page.id DESC,page.kind DESC
    `);
  }

  async history(
    subject: string,
    positionId: string,
    cursor?: {
      date: string;
      id: string;
      kind: "investment" | "link" | "identity";
    },
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
        ...(cursor ? ["identity", cursor.date, cursor.id, cursor.kind] : []),
      )
      .all<{
        kind: "investment" | "link" | "identity";
        id: string;
        accepted_at: string;
        receipt_json: string | null;
        previous_json: string | null;
        source_label: string | null;
        target_label: string | null;
        link_json: string;
        identity_json: string;
        identity_previous_json: string | null;
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
          : row.kind === "identity"
            ? {
                kind: row.kind,
                receipt: JSON.parse(row.identity_json) as unknown,
                previous: row.identity_previous_json
                  ? (JSON.parse(row.identity_previous_json) as unknown)
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

  async acceptDistributions(
    subject: string,
    positionId: string,
    raw: AcceptDistributions,
  ): Promise<PurchaseReceipt> {
    const input = AcceptDistributionsSchema.parse(raw);
    const prior = await this.current(subject, positionId);
    if ((prior?.id ?? null) !== input.expectedReceiptId)
      throw new PositionPurchaseError(
        "stale",
        "The investment changed. Reload before saving.",
      );
    if (
      input.distributionReview.coverage.throughDate >
      new Date().toISOString().slice(0, 10)
    )
      throw new PositionPurchaseError(
        "unsupported",
        "Distribution history cannot be dated in the future.",
      );
    const details = prior?.details ?? { coversPosition: false, lots: [] };
    return this.append(
      subject,
      positionId,
      {
        expectedSnapshotId: input.expectedSnapshotId,
        expectedReceiptId: input.expectedReceiptId,
        expectedTermsId: prior?.supersedesEconomicsTermsId,
        details: {
          ...details,
          investmentSnapshotId:
            details.investmentSnapshotId ??
            prior?.snapshotId ??
            input.expectedSnapshotId,
          distributionReview: input.distributionReview,
        },
      },
      prior,
    );
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
          (p) =>
            p.id === record.sourceEvidenceId ||
            p.id === `import:${record.sourceEvidenceId}`,
        );
        const linkedGpSource =
          source && record.origin === "gp" && source.positionId !== positionId
            ? await this.db
                .prepare(
                  `SELECT 1 FROM holding_position_link_heads
                WHERE target_position_id=? AND source_position_id=? AND state='linked' AND use_source_value=1`,
                )
                .bind(positionId, source.positionId)
                .first()
            : null;
        if (
          !source ||
          source.positionId !== record.sourcePositionId ||
          source.capturedAt !== record.sourceCapturedAt ||
          source.markMicros !== record.priceMicros ||
          source.markDate !== record.priceDate ||
          source.shareClass !== record.shareClass ||
          JSON.stringify(source.shareBasis ?? null) !==
            JSON.stringify(record.shareBasis ?? null) ||
          (source.positionId !== positionId &&
            !linkedGpSource &&
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
      record.followSource || investmentSnapshotId === input.expectedSnapshotId
        ? calculateValuationFromShares(details, record)
        : null;
    if (
      (input.method === "total" && record.totalMinor === null) ||
      (input.method === "shares" && calculation === null)
    )
      throw new PositionPurchaseError(
        "unsupported",
        (() => {
          const result = assessValuationFromShares(details, record);
          return result.ok
            ? "The investment source changed. Review its share coverage in Investment."
            : result.message;
        })(),
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
    const receipt = await this.append(
      subject,
      positionId,
      {
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
            ...(record.followSource && calculation
              ? {
                  calculation: {
                    policy: "linked-price-proxy-v1" as const,
                    quoteId: record.sourceEvidenceId!,
                    quantityReceiptId: prior!.id,
                    ...calculation,
                  },
                }
              : {}),
          },
        },
      },
      prior,
    );
    if (record.origin === "gp" && record.priceMicros !== null)
      await new D1PriceProxyRepository(this.db).refresh(subject);
    return receipt;
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
    // Only accepted source heads: history growth cannot multiply this read.
    // Related IDs require reviewed issuer mappings, never name matching.
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
        SELECT l.source_position_id,l.household_id FROM target t
        CROSS JOIN holding_position_link_heads l ON l.target_position_id=t.id AND l.household_id=t.household_id
          AND l.state='linked' AND l.use_source_value=1
        UNION
        SELECT m.position_id,m.household_id FROM related_exposures related_exposure
        CROSS JOIN holding_position_exposure_heads m ON m.household_id=related_exposure.household_id AND m.exposure_id=related_exposure.id AND m.status='active'
      ), related AS MATERIALIZED (
        SELECT p.id,p.household_id,p.legal_vehicle_name,p.provider FROM related_ids related_id
        CROSS JOIN holding_positions p ON p.id=related_id.id AND p.household_id=related_id.household_id
      )
      SELECT q.id,priced_position.id positionId,priced_position.legal_vehicle_name positionLabel,
        CASE priced_position.provider WHEN 'tokenfolio' THEN 'Tokenfolio' ELSE q.source_label END sourceLabel,q.observed_at observedAt,q.observed_at capturedAt,
        json_object('costMicros',json_extract(e.evidence_json,'$.costMicros'),
          'markMicros',q.price_micros,'markDate',q.price_date,'shareClass',q.share_class,
          'shareBasis',json(q.basis_json),'priceSourcePositionId',q.source_position_id,
          'sourceMetadata',json(CASE WHEN class_quote.id IS NOT NULL OR basis_quote.id IS NOT NULL THEN json_object(
            'policy','accepted-source-continuation-v1','quoteId',class_quote.id,'shareBasisQuoteId',head.share_basis_quote_id,
            'shareClass',class_quote.share_class,'shareBasis',json(CASE WHEN head.share_basis_quote_id IS head.share_class_quote_id THEN class_quote.basis_json ELSE basis_quote.basis_json END)) END)) evidence_json
      FROM related priced_position
      CROSS JOIN holding_price_current_quotes head ON head.source_position_id=priced_position.id AND head.household_id=priced_position.household_id
      CROSS JOIN holding_price_quotes q ON q.id=head.quote_id
      LEFT JOIN holding_price_quotes class_quote ON class_quote.id=head.share_class_quote_id
      LEFT JOIN holding_price_quotes basis_quote ON basis_quote.id=(CASE WHEN head.share_basis_quote_id IS NOT head.share_class_quote_id THEN head.share_basis_quote_id END)
      LEFT JOIN holding_import_share_prices e ON e.import_row_id=q.import_row_id
      WHERE NOT EXISTS(SELECT 1 FROM holding_position_continuities c WHERE c.predecessor_position_id=priced_position.id)
      ORDER BY q.price_date DESC,q.accepted_at DESC,q.id LIMIT 120
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
    if (
      input.details.distributionReview !== undefined &&
      JSON.stringify(input.details.distributionReview) !==
        JSON.stringify(prior?.details.distributionReview)
    )
      throw new PositionPurchaseError(
        "unsupported",
        "Save distribution changes through the distribution review.",
      );
    if (prior?.details.distributionReview)
      input.details.distributionReview = prior.details.distributionReview;
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
    const selectedRecord = prior?.details.valuation?.records.find(
      (r) => r.id === prior.details.valuation?.selected?.recordId,
    );
    if (
      prior?.details.valuation?.selected?.method === "shares" &&
      valuationSharesKey(input.details) !== valuationSharesKey(prior.details)
    )
      if (selectedRecord?.followSource) {
        const result = assessValuationFromShares(input.details, selectedRecord);
        if (!result.ok)
          throw new PositionPurchaseError("unsupported", result.message);
        input.details.valuation = {
          ...prior.details.valuation,
          selected: {
            ...prior.details.valuation.selected,
            sharesKey: valuationSharesKey(input.details),
          },
          calculation: {
            policy: "linked-price-proxy-v1",
            quoteId: selectedRecord.sourceEvidenceId!,
            quantityReceiptId: prior.id,
            ...result.calculation,
          },
        };
      } else
        input.details.valuation = {
          ...prior.details.valuation,
          selected: null,
        };
    return this.append(
      subject,
      positionId,
      input,
      prior,
      Boolean(
        prior &&
        valuationSharesKey(input.details) !== valuationSharesKey(prior.details),
      ),
    );
  }

  private async append(
    subject: string,
    positionId: string,
    raw: AcceptPurchases,
    prior: PurchaseReceipt | null,
    ownsQuantity = false,
  ): Promise<PurchaseReceipt> {
    const input = AcceptPurchasesSchema.parse(raw);
    const position = await this.db
      .prepare(
        `SELECT p.household_id,p.position_kind,p.provider,p.currency,u.id user_id
      FROM users u JOIN households h ON h.owner_user_id=u.id JOIN holding_positions p ON p.household_id=h.id
      WHERE u.access_subject=? AND p.id=?`,
      )
      .bind(subject, positionId)
      .first<{
        household_id: string;
        position_kind: string;
        provider: string;
        currency: string;
        user_id: string;
      }>();
    if (!position)
      throw new PositionPurchaseError("not_found", "Position was not found.");
    if (
      (position.position_kind !== "spv_interest" &&
        position.provider !== "manual") ||
      position.currency !== "USD"
    )
      throw new PositionPurchaseError(
        "unsupported",
        "Investment details support USD SPVs and manual investments.",
      );
    const referenced = input.details.lots.filter(
      (lot) =>
        lot.mark?.sourceEvidenceId &&
        (input.details.investmentSnapshotId !==
          (prior?.details.investmentSnapshotId ?? prior?.snapshotId) ||
          JSON.stringify(lot) !==
            JSON.stringify(
              prior?.details.lots.find((old) => old.id === lot.id),
            )),
    );
    if (referenced.length) {
      const evidence = await this.evidence(subject, positionId);
      for (const lot of referenced) {
        const mark = lot.mark!;
        const source = evidence.find(
          (item) =>
            item.id === mark.sourceEvidenceId ||
            item.id === `import:${mark.sourceEvidenceId}`,
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
    if (
      ownsQuantity &&
      receipt.details.valuation?.calculation &&
      input.details.investmentSnapshotId === input.expectedSnapshotId
    ) {
      receipt.details.valuation.calculation.quantityReceiptId = receipt.id;
    }
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
        /purchase (?:review stale|snapshot stale|provenance mismatch|price evidence stale|value evidence stale|unified terms downgrade|economics review stale|capital does not reconcile|capital refund invalid|distribution invalid)/u.test(
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
