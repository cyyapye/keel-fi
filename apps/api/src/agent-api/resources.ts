import { z } from "zod";
import { InvestmentTermsSchema } from "@keel/domain/investment-details";
import {
  PurchaseReceiptSchema,
  effectivePositionValuation,
} from "@keel/domain/position-purchases";
import { resourceId, GoalConflict } from "./goals";
import { DEBT_WINDOW, currentDebts } from "./outlook";
import { debtStatement } from "./read";
import { debtRow } from "./contract";

const string = z.string(),
  money = z.int().nullable(),
  optionalText = string.nullable();
export const collectionArgs = z.strictObject({
  after: string.min(1).max(2048).optional(),
});
const encode = (parts: (string | number)[]) =>
  encodeURIComponent(JSON.stringify(parts));
function unpack<T extends z.ZodType>(
  after: string | undefined,
  schema: T,
  initial: z.output<T>,
): z.output<T> {
  if (!after) return initial;
  try {
    return schema.parse(JSON.parse(decodeURIComponent(after)));
  } catch {
    throw new GoalConflict(400, "invalid_request", "Invalid page cursor.");
  }
}
function next<T>(rows: T[], key: (record: T) => (string | number)[]) {
  return rows.length > 50 ? encode(key(rows[49]!)) : null;
}

export const position = z.object({
  id: resourceId,
  provider: string,
  name: string,
  kind: string,
  instrument: string,
  owner: string,
  currency: string,
  accountId: optionalText,
  ownership: z.enum(["closed", "recorded"]),
  latestSnapshotId: optionalText,
  reportedValueMinor: money,
  ticker: optionalText.describe(
    "Source-reported ticker in the latest accepted snapshot; null when unavailable.",
  ),
  quantityMicros: z
    .int()
    .nonnegative()
    .nullable()
    .describe(
      "Source-reported quantity in the latest accepted snapshot, in millionths of a security unit (1000000 = one share for equities). Null means unavailable, not zero. Closed positions retain historical quantities; exclude them from current ownership totals.",
    ),
  costBasisMinor: z
    .int()
    .nonnegative()
    .nullable()
    .describe(
      "Source-reported total cost basis for the snapshot quantity, in minor units of currency (USD cents). Null means unavailable, not zero; invested capital or market value is never substituted. This is not tax-lot or realized-gain information.",
    ),
  observedAt: optionalText,
  evidenceId: optionalText,
});
export const positionDetail = position.extend({
  terms: InvestmentTermsSchema.nullable(),
  exposures: z.array(
    z.object({
      id: string,
      name: string,
      kind: string,
      companyId: optionalText,
    }),
  ),
  nextAfterExposure: optionalText,
  reviewedValueMinor: money,
  reviewedValueDate: optionalText,
  reviewId: optionalText,
});
export const positionPage = z.object({
  items: z.array(position),
  nextAfter: optionalText,
});
const positionSQL = `SELECT p.id,p.provider,COALESCE(iv.legal_vehicle_name,p.legal_vehicle_name) name,COALESCE(iv.position_kind,p.position_kind) kind,p.instrument_type instrument,COALESCE(iv.owner_label,p.owner_label) owner,p.currency,
 'container:'||(SELECT o.container_id FROM holding_position_ownerships o WHERE o.position_id=p.id AND o.household_id=p.household_id ORDER BY o.version DESC LIMIT 1) accountId,
 CASE WHEN k.position_id IS NOT NULL AND a.position_id IS NULL THEN 'closed' ELSE 'recorded' END ownership,
 s.id latestSnapshotId,s.unrealized_value_minor reportedValueMinor,s.ticker,s.quantity_micros quantityMicros,s.cost_basis_minor costBasisMinor,s.observed_at observedAt,s.source_document_id evidenceId FROM holding_positions p
 LEFT JOIN manual_holding_identity_heads ih ON ih.position_id=p.id AND ih.household_id=p.household_id
 LEFT JOIN manual_holding_identity_versions iv ON iv.id=ih.version_id AND iv.household_id=p.household_id
 LEFT JOIN holding_import_application_heads h ON h.position_id=p.id
 LEFT JOIN holding_position_snapshots s ON s.id=h.snapshot_id AND s.household_id=p.household_id
 LEFT JOIN public_holding_security_heads k ON k.position_id=p.id AND k.household_id=p.household_id
 LEFT JOIN public_holding_active_positions a ON a.position_id=p.id AND a.household_id=p.household_id`;
export async function positions(db: D1Database, hh: string, after?: string) {
  const cursor = unpack(after, z.tuple([string, string]), ["", ""]);
  const rows = z.array(position).parse(
    (
      await db
        .prepare(
          positionSQL +
            " WHERE p.household_id=? AND (p.provider,p.id)>(?,?) ORDER BY p.provider,p.id LIMIT 51",
        )
        .bind(hh, ...cursor)
        .all()
    ).results,
  );
  return {
    items: rows.slice(0, 50),
    nextAfter: next(rows, (g) => [g.provider, g.id]),
  };
}
export async function onePosition(
  db: D1Database,
  hh: string,
  id: string,
  afterExposure = "",
) {
  const [base, map, purchase] = await db.batch<Record<string, unknown>>([
    db.prepare(positionSQL + " WHERE p.household_id=? AND p.id=?").bind(hh, id),
    db
      .prepare(
        `SELECT e.id,e.canonical_name name,e.exposure_kind kind,e.company_id companyId,m.status FROM
 (SELECT exposure_id,status FROM holding_position_exposure_heads WHERE position_id=? AND household_id=? AND exposure_id>? ORDER BY exposure_id LIMIT 121) m
 JOIN canonical_exposures e ON e.id=m.exposure_id WHERE e.household_id=? ORDER BY e.id`,
      )
      .bind(id, hh, afterExposure, hh),
    db
      .prepare(
        `SELECT r.receipt_json receipt FROM holding_purchase_heads h JOIN holding_purchase_reviews r ON r.id=h.review_id AND r.household_id=h.household_id WHERE h.position_id=? AND h.household_id=?`,
      )
      .bind(id, hh),
  ]);
  if (!base!.results.length) return null;
  const row = position.parse(base!.results[0]);
  const raw = purchase!.results[0];
  const receipt = raw
    ? PurchaseReceiptSchema.parse(JSON.parse(string.parse(raw.receipt)))
    : null;
  const reviewed =
    receipt && row.latestSnapshotId
      ? effectivePositionValuation(receipt, row.latestSnapshotId)
      : null;
  return positionDetail.parse({
    ...row,
    terms: receipt?.details.investmentTerms ?? null,
    exposures: map!.results.slice(0, 120).filter((r) => r.status === "active"),
    nextAfterExposure:
      map!.results.length > 120
        ? resourceId.parse(map!.results[119]!.id)
        : null,
    reviewedValueMinor: reviewed?.valueMinor ?? null,
    reviewedValueDate: reviewed?.effectiveDate ?? null,
    reviewId: receipt?.id ?? null,
  });
}

export const account = z.object({
  id: resourceId,
  name: string,
  kind: string,
  balanceMinor: money,
  currency: optionalText,
  observedAt: optionalText,
  evidenceId: optionalText,
  basis: z.enum([
    "asset_directory",
    "ownership_container",
    "accepted_cash_baseline",
  ]),
  baselineId: optionalText,
});
export const accountPage = z.object({
  items: z.array(account),
  nextAfter: optionalText,
});
const dirSQL = `SELECT 'asset:'||d.id id,d.name,d.account_type kind,NULL balanceMinor,NULL currency,NULL observedAt,NULL evidenceId,'asset_directory' basis,NULL baselineId,d.rowid cursor FROM asset_accounts d`;
const containerSQL = `SELECT 'container:'||c.id id,v.display_label name,v.container_kind kind,NULL balanceMinor,NULL currency,h.source_updated_at observedAt,i.source_document_id evidenceId,'ownership_container' basis,NULL baselineId,c.connection_id connection,c.created_at created,c.rowid cursor FROM ownership_containers c
 JOIN ownership_container_versions v ON v.id=(SELECT id FROM ownership_container_versions WHERE container_id=c.id ORDER BY version DESC LIMIT 1) AND v.household_id=c.household_id
 LEFT JOIN public_holding_account_inventory_heads h ON h.container_id=c.id LEFT JOIN holding_imports i ON i.id=h.inventory_id AND i.household_id=c.household_id`;
const cashSQL = `SELECT 'cash:'||i.natural_key_sha256 id,r.account_label name,r.subtype kind,i.value_minor balanceMinor,'USD' currency,i.observed_at observedAt,'cash-review:'||i.review_decision_id evidenceId,'accepted_cash_baseline' basis,i.baseline_id baselineId,i.natural_key_sha256 naturalKey FROM portfolio_baseline_cash_items i JOIN cash_balance_proposal_rows r ON r.id=i.proposal_row_id AND r.household_id=i.household_id`;
const accountCursor = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("directory"), row: z.int().nonnegative() }),
  z.object({
    phase: z.literal("containers"),
    connection: string,
    created: string,
    row: z.int().nonnegative(),
  }),
  z.object({ phase: z.literal("cash"), baselineId: string, key: string }),
]);
type AccountCursor = z.infer<typeof accountCursor>;
const accountAfter = (cursor: AccountCursor) =>
  encodeURIComponent(JSON.stringify(cursor));
async function latestBaseline(db: D1Database, hh: string) {
  return db
    .prepare(
      "SELECT id FROM portfolio_baselines WHERE household_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",
    )
    .bind(hh)
    .first<string>("id");
}
export async function accounts(
  db: D1Database,
  hh: string,
  after?: string,
  baselineId?: string,
) {
  const cursor = unpack(
    after,
    accountCursor,
    baselineId
      ? { phase: "cash", baselineId, key: "" }
      : { phase: "directory", row: 0 },
  );
  if (
    baselineId &&
    (cursor.phase !== "cash" || cursor.baselineId !== baselineId)
  )
    throw new GoalConflict(
      400,
      "invalid_request",
      "Cursor does not match the requested baseline.",
    );
  let rows: Record<string, unknown>[],
    following: AccountCursor | null = null;
  if (cursor.phase === "directory") {
    rows = (
      await db
        .prepare(
          dirSQL +
            " WHERE d.household_id=? AND d.rowid>? ORDER BY d.rowid LIMIT 51",
        )
        .bind(hh, cursor.row)
        .all()
    ).results;
    following =
      rows.length > 50
        ? { phase: "directory", row: z.int().parse(rows[49]!.cursor) }
        : { phase: "containers", connection: "", created: "", row: 0 };
  } else if (cursor.phase === "containers") {
    rows = (
      await db
        .prepare(
          containerSQL +
            " WHERE c.household_id=? AND (c.connection_id,c.created_at,c.rowid)>(?,?,?) ORDER BY c.connection_id,c.created_at,c.rowid LIMIT 51",
        )
        .bind(hh, cursor.connection, cursor.created, cursor.row)
        .all()
    ).results;
    if (rows.length > 50) {
      const last = rows[49]!;
      following = {
        phase: "containers",
        connection: string.parse(last.connection),
        created: string.parse(last.created),
        row: z.int().parse(last.cursor),
      };
    } else {
      const base = await latestBaseline(db, hh);
      if (base) following = { phase: "cash", baselineId: base, key: "" };
    }
  } else {
    const [base, page] = await db.batch<Record<string, unknown>>([
      db
        .prepare(
          "SELECT id FROM portfolio_baselines WHERE id=? AND household_id=?",
        )
        .bind(cursor.baselineId, hh),
      db
        .prepare(
          cashSQL +
            " WHERE i.baseline_id=? AND i.household_id=? AND i.natural_key_sha256>? ORDER BY i.natural_key_sha256 LIMIT 51",
        )
        .bind(cursor.baselineId, hh, cursor.key),
    ]);
    if (!base!.results.length)
      throw new GoalConflict(404, "not_found", "Baseline not found.");
    rows = page!.results;
    if (rows.length > 50)
      following = { ...cursor, key: string.parse(rows[49]!.naturalKey) };
  }
  return accountPage.parse({
    items: rows.slice(0, 50),
    nextAfter: following ? accountAfter(following) : null,
  });
}
export async function oneAccount(db: D1Database, hh: string, id: string) {
  const sep = id.indexOf(":"),
    key = id.slice(sep + 1);
  const query = id.startsWith("asset:")
    ? db.prepare(dirSQL + " WHERE d.household_id=? AND d.id=?").bind(hh, key)
    : id.startsWith("container:")
      ? db
          .prepare(containerSQL + " WHERE c.household_id=? AND c.id=?")
          .bind(hh, key)
      : id.startsWith("cash:")
        ? db
            .prepare(
              cashSQL +
                " WHERE i.household_id=? AND i.natural_key_sha256=? AND i.baseline_id=(SELECT id FROM portfolio_baselines WHERE household_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1)",
            )
            .bind(hh, key, hh)
        : null;
  const row = await query?.first();
  return row ? account.parse(row) : null;
}
export const liability = z.object({
  id: string,
  name: string,
  kind: string,
  balanceMinor: money,
  paymentMinor: money,
  treatment: optionalText,
  effectiveDate: string,
  evidenceId: string,
});
export const liabilityPage = z.object({
  items: z.array(liability),
  nextAfter: optionalText,
});
export async function liabilities(db: D1Database, hh: string) {
  const result = await debtStatement(db, hh).all();
  if (result.results.length > DEBT_WINDOW)
    throw new ResourceUnavailable("debt_history_limit");
  const rows = z
    .array(debtRow.extend({ name: string, kind: string }))
    .parse(result.results);
  return currentDebts(rows)
    .map((r) =>
      liability.parse({ ...r, id: r.key, evidenceId: "debt-review:" + r.id }),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
export class ResourceUnavailable extends Error {}
export const baselineDetail = z.object({
  id: string,
  sourceRevision: string,
  sourceObservedAt: string,
  recordedAt: string,
  publicMarketMinor: z.int(),
  privatePaperMinor: z.int(),
  acceptedCashMinor: z.int(),
  otherLiquidMinor: z.int(),
  liquidMinor: z.int(),
  unknownValues: z.int(),
  unknownCashAccounts: z.int(),
  marks: string,
  cashAccounts: string,
});
export async function oneBaseline(db: D1Database, hh: string, id: string) {
  const row = await db
    .prepare(
      `SELECT id,source_revision sourceRevision,source_observed_at sourceObservedAt,created_at recordedAt,public_market_value_minor publicMarketMinor,private_paper_value_minor privatePaperMinor,cash_account_value_minor acceptedCashMinor,fi_eligible_liquid_minor-public_market_value_minor-cash_account_value_minor otherLiquidMinor,fi_eligible_liquid_minor liquidMinor,unknown_value_count unknownValues,unknown_cash_account_count unknownCashAccounts FROM portfolio_baselines WHERE id=? AND household_id=?`,
    )
    .bind(id, hh)
    .first();
  const suffix = "?baselineId=" + encodeURIComponent(id);
  return row
    ? baselineDetail.parse({
        ...row,
        marks: "/api/v1/marks" + suffix,
        cashAccounts: "/api/v1/accounts" + suffix,
      })
    : null;
}
export const citation = z.object({
  id: string,
  sourceType: string,
  label: string,
  reference: optionalText,
  effectiveAt: optionalText,
  capturedAt: optionalText,
});
export async function evidence(db: D1Database, hh: string, id: string) {
  const queries = [
    db
      .prepare(
        "SELECT 'investment_history' sourceType,'Broker-reported investment activity and lots' label,i.source_document_id reference,NULL effectiveAt,c.captured_at capturedAt FROM investment_history_captures c JOIN holding_imports i ON i.id=c.import_id AND i.household_id=c.household_id WHERE c.id=? AND c.household_id=?",
      )
      .bind(id, hh),
    db
      .prepare(
        "SELECT 'document' sourceType,source_label label,file_name reference,effective_date effectiveAt,retrieved_at capturedAt FROM source_documents WHERE id=? AND household_id=?",
      )
      .bind(id, hh),
    db
      .prepare(
        "SELECT 'public_signal' sourceType,source_title label,source_url reference,published_at effectiveAt,retrieved_at capturedAt FROM public_source_observations WHERE id=? AND household_id=?",
      )
      .bind(id, hh),
    db
      .prepare(
        "SELECT 'event' sourceType,headline label,source_document_id reference,effective_date effectiveAt,retrieved_at capturedAt FROM evidence_events WHERE id=? AND household_id=?",
      )
      .bind(id, hh),
    db
      .prepare(
        "SELECT 'price_quote' sourceType,source_label label,source_url reference,price_date effectiveAt,observed_at capturedAt FROM holding_price_quotes WHERE id=? AND household_id=?",
      )
      .bind(id, hh),
    db
      .prepare(
        "SELECT 'holding_snapshot' sourceType,p.legal_vehicle_name label,s.source_document_id reference,NULL effectiveAt,s.observed_at capturedAt FROM holding_position_snapshots s JOIN holding_positions p ON p.id=s.position_id AND p.household_id=s.household_id WHERE s.id=? AND s.household_id=?",
      )
      .bind(id, hh),
    db
      .prepare(
        "SELECT 'purchase_review' sourceType,p.legal_vehicle_name label,r.snapshot_id reference,NULL effectiveAt,r.accepted_at capturedAt FROM holding_purchase_reviews r JOIN holding_positions p ON p.id=r.position_id AND p.household_id=r.household_id WHERE r.id=? AND r.household_id=?",
      )
      .bind(id, hh),
    db
      .prepare(
        "SELECT 'liability_review' sourceType,r.account_label label,d.proposal_id reference,r.effective_date effectiveAt,r.observed_at capturedAt FROM liability_review_decisions d JOIN liability_proposal_rows r ON r.id=d.proposal_row_id AND r.household_id=d.household_id WHERE d.id=? AND d.household_id=? AND d.decision='accepted'",
      )
      .bind(id.replace(/^debt-review:/, ""), hh),
    db
      .prepare(
        "SELECT 'cash_review' sourceType,r.account_label label,d.proposal_id reference,NULL effectiveAt,r.observed_at capturedAt FROM cash_balance_review_decisions d JOIN cash_balance_proposal_rows r ON r.id=d.proposal_row_id AND r.household_id=d.household_id WHERE d.id=? AND d.household_id=? AND d.decision='accepted'",
      )
      .bind(id.replace(/^cash-review:/, ""), hh),
  ];
  const rows = (await db.batch<Record<string, unknown>>(queries)).flatMap(
    (r) => r.results,
  );
  return rows.length === 1 ? citation.parse({ id, ...rows[0] }) : null;
}
