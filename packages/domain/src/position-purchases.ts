import {
  GpMarkPriceSchema,
  MarketQuoteSchema,
  type MarketQuote,
} from "./market-close";
import { z } from "zod";
import { PositionLinkReceiptSchema } from "./position-link-receipt";
import { InvestmentFeeSchema, investmentFeeAmount } from "./investment-fees";
import {
  ShareBasisSchema,
  SourcePriceMetadataSchema,
  ValuationStateSchema,
  type ValuationRecord,
} from "./valuation-record";
import {
  InvestmentTermsSchema,
  DistributionReviewSchema,
  reconcileInvestmentCapital,
  unknownInvestmentTerms,
  type ReviewedInvestment,
} from "./investment-details";
import {
  calculatePositionEconomics,
  type PositionEconomicsContext,
} from "./position-economics";

const money = z.number().int().safe().nonnegative();
const positive = z.number().int().safe().positive().max(1_000_000_000_000);
const text = z.string().trim().min(1).max(500);
// Share prices are integer millionths of one currency unit. Final values are
// integer minor units; never round a sub-cent share price before multiplication.
export const PurchaseLotSchema = z
  .object({
    quantityDetails: z
      .object({
        status: z.enum(["estimated", "confirmed"]),
        derivation: text,
        evidence: z.string().trim().min(1).max(12_000).nullable(),
        shareBasis: ShareBasisSchema,
      })
      .strict()
      .optional(),
    id: z.string().min(1).max(100),
    fees: z.array(InvestmentFeeSchema).max(12).optional(),
    feesComplete: z.boolean().optional(),
    transactionType: z.enum(["primary", "secondary"]).nullable().optional(),
    referenceRound: text.nullable().optional(),
    reportedPremiumPpm: z
      .number()
      .int()
      .min(0)
      .max(10_000_000)
      .nullable()
      .optional(),
    reportedManagementFeePpm: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    reportedCarryPpm: z
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .nullable()
      .optional(),
    sourceText: z.string().max(12_000).nullable().optional(),
    sourceKind: z
      .enum(["executed", "deal_snapshot", "other", "unknown"])
      .optional(),
    sourceObservedOn: z.iso.date().nullable().optional(),
    purchasedOn: z.iso.date().nullable(),
    shareClass: text.nullable(),
    priceMicros: positive.nullable(),
    referencePriceMicros: positive.nullable(),
    upfrontDeductionsMinor: money.max(10_000_000_000_000).nullable().optional(),
    capitalReturn: z
      .object({
        amountMinor: money.positive().max(10_000_000_000_000),
        status: z.enum(["expected", "received"]),
        effectiveDate: z.iso.date().nullable(),
        reportedDistributions: z.enum(["unknown", "included", "excluded"]),
      })
      .strict()
      .optional(),
    nominalSpvUnitsMicros: money.max(1_000_000_000_000).nullable().optional(),
    grossCashMinor: money.max(10_000_000_000_000).nullable(),
    netCapitalMinor: money.max(10_000_000_000_000).nullable(),
    feePpm: z.number().int().min(0).max(1_000_000).nullable(),
    feeBasis: z.enum(["gross_cash", "net_capital"]).nullable(),
    feeLabel: text.nullable(),
    originalSharesUnchanged: z.boolean().default(false),
    remainingSharesMicros: money.max(1_000_000_000_000).nullable(),
    sharesAsOf: z.iso.date().nullable(),
    sourceLabel: text.nullable(),
    sourceUrl: z.url().max(2048).nullable(),
    mark: z
      .object({
        sourceEvidenceId: text.optional(),
        comparableConfirmed: z.literal(true).optional(),
        proxy: z
          .object({
            confirmed: z.literal(true),
            reason: z
              .string()
              .trim()
              .min(1, "Explain why this proxy is appropriate.")
              .max(500),
            capturedAt: z.iso.datetime(),
          })
          .strict()
          .optional(),
        priceMicros: positive,
        effectiveDate: z.iso.date().nullable(),
        shareClass: text.nullable(),
        sourceLabel: text,
        sourceUrl: z.url().max(2048).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((lot, ctx) => {
    const refund = lot.capitalReturn;
    if (refund) {
      if (
        lot.grossCashMinor === null ||
        refund.amountMinor > lot.grossCashMinor
      )
        ctx.addIssue({
          code: "custom",
          path: ["capitalReturn", "amountMinor"],
          message: "Record cash paid; the capital refund cannot exceed it.",
        });
      if (
        refund.status === "expected" &&
        refund.reportedDistributions !== "unknown"
      )
        ctx.addIssue({
          code: "custom",
          path: ["capitalReturn", "reportedDistributions"],
          message: "An expected refund cannot be a received distribution.",
        });
    }
    if (lot.mark) {
      const mark = lot.mark;
      if (
        mark.proxy
          ? !mark.sourceEvidenceId || mark.comparableConfirmed
          : !mark.effectiveDate || !mark.shareClass
      )
        ctx.addIssue({
          code: "custom",
          path: ["mark"],
          message: mark.proxy
            ? "Select source price evidence and accept it as a proxy, not a matching share class."
            : "A matching share price needs its date and share class.",
        });
    }
    if (lot.feePpm === null && lot.feeBasis !== null)
      ctx.addIssue({
        code: "custom",
        path: ["feeBasis"],
        message: "Enter the fee rate or clear its basis.",
      });
    if (
      lot.grossCashMinor !== null &&
      lot.netCapitalMinor !== null &&
      lot.netCapitalMinor > lot.grossCashMinor
    )
      ctx.addIssue({
        code: "custom",
        path: ["netCapitalMinor"],
        message: "Share capital cannot exceed cash contributed.",
      });
    if (
      lot.mark?.effectiveDate &&
      lot.purchasedOn &&
      lot.mark.effectiveDate < lot.purchasedOn
    )
      ctx.addIssue({
        code: "custom",
        path: ["mark"],
        message: "The valuation price predates this purchase.",
      });
    const capital = purchaseCapital(lot);
    if (capital.conflict)
      ctx.addIssue({
        code: "custom",
        path: ["netCapitalMinor"],
        message:
          lot.upfrontDeductionsMinor !== undefined
            ? "Cash, net capital and upfront deductions do not reconcile."
            : "Cash, share capital and the one-time fee do not reconcile.",
      });
  });
export const PurchaseDetailsSchema = z
  .object({
    distributionReview: DistributionReviewSchema.optional(),
    valuation: ValuationStateSchema.optional(),
    investmentSnapshotId: z.string().min(1).optional(),
    investmentTerms: InvestmentTermsSchema.optional(),
    cashCoversPosition: z.boolean().optional(),
    coversPosition: z.boolean().default(false),
    lots: z.array(PurchaseLotSchema).max(20),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.lots.map((lot) => lot.id)).size !== value.lots.length)
      ctx.addIssue({
        code: "custom",
        path: ["lots"],
        message: "Each purchase must have a unique identifier.",
      });
    if (value.investmentTerms && value.cashCoversPosition) {
      const capital = value.lots.map(purchaseCapital);
      if (capital.some((row) => row.conflict)) return;
      for (const key of [
        "grossCashMinor",
        "netCapitalMinor",
        "upfrontDeductionsMinor",
      ] as const) {
        if (
          capital.reduce((total, row) => total + BigInt(row[key] ?? 0), 0n) >
          BigInt(Number.MAX_SAFE_INTEGER)
        )
          ctx.addIssue({
            code: "custom",
            path: ["lots"],
            message: "Purchase totals exceed supported precision.",
          });
      }
    }
  });
export const PurchaseReceiptSchema = z.object({
  publicClose: MarketQuoteSchema.extend({
    exposureId: z.string().min(1),
  }).optional(),
  latestGpPrice: GpMarkPriceSchema.optional(),
  supersedesEconomicsTermsId: z.string().min(1).nullable().optional(),
  id: z.string().min(1),
  positionId: z.string().min(1),
  snapshotId: z.string().min(1),
  currency: z.literal("USD"),
  details: PurchaseDetailsSchema,
  acceptedAt: z.iso.datetime(),
});
const ManualIdentityHistoryValueSchema = z.object({
  name: z.string().min(1).max(1_000),
  kind: z.enum(["direct", "spv_interest", "fund_interest"]),
  ownerLabel: z.string().min(1).max(1_000),
  companies: z
    .array(z.object({ id: z.string().min(1), name: z.string().min(1) }))
    .max(500),
});
export const InvestmentHistorySchema = z.object({
  entries: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("investment"),
          receipt: PurchaseReceiptSchema,
          previous: PurchaseReceiptSchema.nullable(),
        }),
        z.object({
          kind: z.literal("link"),
          receipt: PositionLinkReceiptSchema,
          sourceLabel: z.string().min(1),
          targetLabel: z.string().min(1),
        }),
        z.object({
          kind: z.literal("identity"),
          receipt: z.object({
            id: z.string().min(1),
            acceptedAt: z.iso.datetime(),
            value: ManualIdentityHistoryValueSchema,
            initialInvestment: PurchaseReceiptSchema.nullable().optional(),
          }),
          previous: ManualIdentityHistoryValueSchema.nullable(),
        }),
      ]),
    )
    .max(30),
  next: z
    .object({
      date: z.iso.datetime(),
      id: z.string().min(1).max(200),
      kind: z.enum(["investment", "link", "identity"]),
    })
    .nullable(),
});
export const AcceptPurchasesSchema = z
  .object({
    expectedSnapshotId: z.string().min(1),
    expectedReceiptId: z.string().min(1).nullable(),
    expectedTermsId: z.string().min(1).nullable().optional(),
    details: PurchaseDetailsSchema,
  })
  .strict();
export const AcceptDistributionsSchema = z
  .object({
    expectedSnapshotId: z.string().min(1),
    expectedReceiptId: z.string().min(1).nullable(),
    distributionReview: DistributionReviewSchema,
  })
  .strict();
export type AcceptDistributions = z.infer<typeof AcceptDistributionsSchema>;
export const PriceProxyStatusSchema = z.object({
  lastObservationAt: z.iso.datetime(),
  lastSuccessfulSyncAt: z.iso.datetime().nullable(),
  stale: z.boolean(),
});
export const PurchaseContextSchema = z.object({
  priceProxyStatus: PriceProxyStatusSchema.nullable().optional(),
  reportedValueSnapshotId: z.string().min(1).optional(),
  reportedValueMinor: money.nullable().optional(),
  reportedSourceLabel: text.optional(),
  sourceObservedOn: z.iso.date().nullable().optional(),
  snapshotId: z.string().min(1),
  currency: z.literal("USD"),
  openedOn: z.iso.date().nullable(),
  receipt: PurchaseReceiptSchema.nullable(),
});
export type PurchaseLot = z.infer<typeof PurchaseLotSchema>;
export type PurchaseReceipt = z.infer<typeof PurchaseReceiptSchema>;
export type AcceptPurchases = z.infer<typeof AcceptPurchasesSchema>;

export function purchaseFeeSummary(lot: PurchaseLot) {
  if (!lot.fees || !lot.feesComplete) return null;
  const amounts = lot.fees
    .filter(
      (fee) => fee.paymentStatus !== "unpaid" && fee.treatment === "upfront",
    )
    .map((fee) =>
      investmentFeeAmount(fee, {
        grossCashMinor: lot.grossCashMinor,
        refundMinor:
          lot.capitalReturn?.status === "received"
            ? lot.capitalReturn.amountMinor
            : 0,
        netCapitalMinor: lot.netCapitalMinor,
      }),
    );
  if (amounts.some((amount) => amount === null)) return null;
  const total = amounts.reduce<bigint>(
    (sum, amount) => sum + BigInt(amount!),
    0n,
  );
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {
    amountMinor: Number(total),
    estimated: lot.fees.some(
      (fee) =>
        fee.paymentStatus !== "unpaid" &&
        fee.treatment === "upfront" &&
        fee.method === "percentage",
    ),
  };
}

/** Only effective ownership dependencies: metadata corrections do not reprice. */
export function valuationSharesKey(details: PurchaseReceipt["details"]) {
  return JSON.stringify({
    coversPosition: details.coversPosition,
    shares: details.lots
      .map((lot) => ({
        id: lot.id,
        quantity: purchaseShares(lot)?.quantityMicros ?? null,
        shareClass: lot.shareClass?.trim().toLowerCase() ?? null,
        date: lot.sharesAsOf,
        ...(lot.quantityDetails
          ? {
              basis: lot.quantityDetails.shareBasis,
              status: lot.quantityDetails.status,
            }
          : {}),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  });
}

export function calculateValuationFromShares(
  details: PurchaseReceipt["details"],
  record: ValuationRecord,
) {
  const result = assessValuationFromShares(details, record);
  return result.ok ? result.calculation : null;
}

export function assessValuationFromShares(
  details: PurchaseReceipt["details"],
  record: Pick<
    ValuationRecord,
    | "priceMicros"
    | "followSource"
    | "sourceContinuation"
    | "priceDate"
    | "sourceCapturedAt"
    | "shareClass"
    | "shareBasis"
    | "crossClassProxy"
  > & { origin: ValuationRecord["origin"] | "public_close" },
) {
  const failure = (code: string, message: string) => ({
    ok: false as const,
    code,
    message,
  });
  if (record.priceMicros === null)
    return failure("missing_price", "This source has no accepted share price.");
  const continuation = record.followSource
    ? record.sourceContinuation
    : undefined;
  // An accepted source observation can continue an explicitly followed proxy.
  // Retrieval bounds quantity applicability; it never becomes the mark date.
  const quantityThrough =
    record.priceDate ??
    (continuation ? record.sourceCapturedAt?.slice(0, 10) : null);
  if (!quantityThrough)
    return failure(
      "missing_price_date",
      "The source price has no date. Save its share-price date in the source holding's valuation.",
    );
  if (!details.lots.length || details.lots.some((lot) => !purchaseShares(lot)))
    return failure(
      "missing_quantity",
      "Record the position's economic shares in Investment. A documented estimate is supported.",
    );
  if (!details.coversPosition)
    return failure(
      "incomplete_coverage",
      "The recorded shares do not cover the whole position. Review share coverage in Investment.",
    );
  const shareClass = record.shareClass ?? continuation?.shareClass;
  const shareBasis = record.shareBasis ?? continuation?.shareBasis;
  if (!shareClass)
    return failure(
      "missing_share_class",
      "The source price needs its share class.",
    );
  const latestStockDistribution = details.distributionReview?.events
    .filter((event) => event.kind === "in_kind")
    .map((event) => event.receivedOn)
    .sort()
    .at(-1);
  if (
    latestStockDistribution &&
    details.lots.some(
      (lot) => !lot.sharesAsOf || lot.sharesAsOf < latestStockDistribution,
    )
  )
    return failure(
      "distribution_quantity_date",
      "Review remaining shares through the latest in-kind distribution.",
    );
  let numerator = 0n,
    denominator = 1n;
  let estimatedShares = false;
  const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));
  for (const lot of details.lots) {
    const shares = purchaseShares(lot)!;
    if (!lot.sharesAsOf)
      return failure(
        "missing_quantity_date",
        "The shares need an effective date in Investment.",
      );
    if (
      lot.sharesAsOf > quantityThrough ||
      (lot.purchasedOn && lot.purchasedOn > quantityThrough)
    )
      return failure(
        "quantity_date",
        "These shares take effect after this price. Use a later price or the applicable historical quantity.",
      );
    if (!lot.shareClass)
      return failure(
        "missing_share_class",
        "Record the position's share class in Investment.",
      );
    if (
      lot.shareClass.trim().toLowerCase() !== shareClass.trim().toLowerCase() &&
      (record.origin !== "proxy" ||
        (record.followSource && !record.crossClassProxy))
    )
      return failure(
        "cross_class",
        "This source prices a different share class. Explicitly accept it as an indicative cross-class proxy.",
      );
    const basis = lot.quantityDetails?.shareBasis;
    if (
      (record.followSource && (!basis || !shareBasis)) ||
      Boolean(basis) !== Boolean(shareBasis) ||
      (basis && shareBasis && basis.key !== shareBasis.key)
    )
      return failure(
        "incompatible_basis",
        "The shares and source price need the same documented split basis. Review their basis in Investment and the source valuation.",
      );
    const units = BigInt(basis?.unitsPerOriginal ?? 1);
    const quoteUnits = BigInt(shareBasis?.unitsPerOriginal ?? 1);
    numerator =
      numerator * units +
      BigInt(shares.quantityMicros) * quoteUnits * denominator;
    denominator *= units;
    const common = gcd(numerator, denominator);
    numerator /= common;
    denominator /= common;
    estimatedShares ||=
      lot.quantityDetails?.status === "estimated" || shares.derived;
  }
  const divisor = denominator * 10_000_000_000n;
  const value =
    (numerator * BigInt(record.priceMicros) + divisor / 2n) / divisor;
  const quantity = (numerator + denominator / 2n) / denominator;
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    quantity > BigInt(Number.MAX_SAFE_INTEGER)
  )
    return failure(
      "precision",
      "This calculation exceeds supported precision.",
    );
  return {
    ok: true as const,
    calculation: {
      valueMinor: Number(value),
      quantityMicros: Number(quantity),
      estimatedShares,
    },
  };
}

export function netInvestmentDate(receipt: PurchaseReceipt): string | null {
  let latest = "";
  for (const lot of receipt.details.lots) {
    if (lot.purchasedOn === null) return null;
    if (lot.purchasedOn > latest) latest = lot.purchasedOn;
    if (lot.capitalReturn?.status === "received") {
      const date = lot.capitalReturn.effectiveDate;
      if (date === null) return null;
      if (date > latest) latest = date;
    }
  }
  return latest || null;
}

export function netInvestedValuation(
  receipt: PurchaseReceipt | null | undefined,
  snapshotId: string,
): ValuationRecord | null {
  const investment = reviewedInvestmentFromReceipt(receipt);
  if (
    !receipt ||
    !investment ||
    investment.snapshotId !== snapshotId ||
    investment.netCapitalMinor === null
  )
    return null;
  return {
    id: "at-cost",
    origin: "at_cost",
    totalMinor: investment.netCapitalMinor,
    priceMicros: null,
    effectiveDate: netInvestmentDate(receipt),
    priceDate: null,
    shareClass: null,
    carryStatus: "unknown",
    sourceLabel: "At cost · Net invested",
    sourceUrl: null,
    sourceEvidenceId: null,
    sourcePositionId: null,
    sourceCapturedAt: null,
    watchEvidenceId: null,
  };
}

export function selectedPositionValuation(
  receipt: PurchaseReceipt | null | undefined,
  snapshotId: string,
) {
  if (!receipt) return null;
  const selection = receipt.details.valuation?.selected;
  const record = receipt.details.valuation?.records.find(
    (r) => r.id === selection?.recordId,
  );
  if (!selection || !record) return null;
  const cost =
    record.origin === "at_cost"
      ? netInvestedValuation(receipt, snapshotId)
      : null;
  if (record.origin === "at_cost" && record.totalMinor !== cost?.totalMinor)
    return null;
  // A deliberately linked quantity model remains applicable until superseded;
  // a provider's newer balance observation does not change ownership.
  if (
    !record.followSource &&
    (receipt.snapshotId !== snapshotId ||
      receipt.details.valuation?.snapshotId !== snapshotId)
  )
    return null;
  const calculated =
    selection.method === "shares" &&
    selection.sharesKey === valuationSharesKey(receipt.details) &&
    (record.followSource ||
      (receipt.details.investmentSnapshotId ?? receipt.snapshotId) ===
        snapshotId)
      ? calculateValuationFromShares(receipt.details, record)
      : null;
  const valueMinor =
    selection.method === "total"
      ? record.totalMinor
      : (calculated?.valueMinor ?? null);
  if (valueMinor === null) return null;
  return {
    ...record,
    method: selection.method,
    effectiveDate: cost
      ? cost.effectiveDate
      : selection.method === "shares"
        ? record.priceDate
        : record.effectiveDate,
    valueMinor,
    quantityMicros: calculated?.quantityMicros ?? null,
    estimatedShares: calculated?.estimatedShares ?? false,
    carryStatus:
      selection.method === "shares"
        ? ("before_carry" as const)
        : record.carryStatus,
  };
}

export function publicClosingValuation(
  receipt: PurchaseReceipt,
  quote: MarketQuote,
) {
  const record = {
    id: quote.id,
    origin: "public_close" as const,
    method: "shares" as const,
    totalMinor: null,
    priceMicros: quote.priceMicros,
    priceDate: quote.date,
    effectiveDate: quote.date,
    shareClass: quote.shareClass,
    shareBasis: quote.shareBasis,
    sourceLabel: "Closing-price estimate",
    carryStatus: "before_carry" as const,
    sourceUrl: quote.sourceUrl,
    sourceEvidenceId: quote.id,
    sourcePositionId: null,
    sourceCapturedAt: null,
    watchEvidenceId: null,
    followSource: true,
  };
  const assessment = assessValuationFromShares(receipt.details, record);
  return assessment.ok ? { ...record, ...assessment.calculation } : null;
}

/** A reviewed GP total remains usable when its independent share calculation expires. */
export function effectivePositionValuation(
  receipt: PurchaseReceipt | null | undefined,
  snapshotId: string,
) {
  if (receipt?.publicClose) {
    const close = publicClosingValuation(receipt, receipt.publicClose);
    if (close) return close;
  }
  const selected = selectedPositionValuation(receipt, snapshotId);
  if (selected) return selected;
  if (
    !receipt ||
    receipt.snapshotId !== snapshotId ||
    receipt.details.valuation?.snapshotId !== snapshotId
  )
    return null;
  const gp = receipt.details.valuation?.records.find(
    (r) => r.id === "gp" && r.origin === "gp" && r.totalMinor !== null,
  );
  return gp
    ? {
        ...gp,
        method: "total" as const,
        valueMinor: gp.totalMinor!,
        quantityMicros: null,
      }
    : null;
}

// Only a single, fully funded purchase can inherit the position's capital.
// This fills missing evidence in an editable draft, never an accepted receipt.
export function prefillPurchaseCapital(
  receipt: PurchaseReceipt,
  context: PositionEconomicsContext | null | undefined,
): PurchaseLot[] {
  const lots = receipt.details.lots;
  if (
    !context ||
    receipt.snapshotId !== context.snapshotId ||
    lots.length !== 1
  )
    return lots;
  const economics = calculatePositionEconomics(context);
  if (
    !economics ||
    (economics.fundedMinor !== economics.committedMinor &&
      !(
        context.acceptedTerms?.capitalBasis === "net_invested" &&
        economics.fundedMinor === context.committedMinor
      ))
  )
    return lots;
  return lots.map((lot) => {
    if (
      lot.capitalReturn ||
      lot.grossCashMinor !== null ||
      lot.netCapitalMinor !== null
    )
      return lot;
    // Purchase capital excludes SPV fees; preserve the separately paid cash in
    // position economics instead of charging those fees again in the lot.
    const acceptedFee = context.acceptedTerms?.purchaseFee;
    if (
      acceptedFee &&
      (acceptedFee.ratePpm !== lot.feePpm || acceptedFee.basis !== lot.feeBasis)
    )
      return lot;
    const capital = acceptedFee
      ? economics.positionCostBasisMinor
      : purchaseCapital({
          ...lot,
          grossCashMinor: economics.positionCostBasisMinor,
        }).netCapitalMinor;
    const candidate = {
      ...lot,
      netCapitalMinor: capital,
    };
    return PurchaseLotSchema.safeParse(candidate).success ? candidate : lot;
  });
}

// Upgrade a missing cash record from a fully funded legacy review. Preserve
// already entered amounts; their scope still needs the whole-cash confirmation.
export function prefillInvestmentCapital(
  receipt: PurchaseReceipt,
  context: PositionEconomicsContext | null | undefined,
): PurchaseLot[] {
  if (
    receipt.details.investmentTerms ||
    !context ||
    receipt.snapshotId !== context.snapshotId ||
    receipt.details.lots.length !== 1
  )
    return receipt.details.lots;
  const economics = calculatePositionEconomics(context);
  if (
    !economics ||
    (economics.fundedMinor !== economics.committedMinor &&
      !(
        context.acceptedTerms?.capitalBasis === "net_invested" &&
        economics.fundedMinor === context.committedMinor
      ))
  )
    return receipt.details.lots;
  return receipt.details.lots.map((lot) =>
    lot.capitalReturn ||
    lot.grossCashMinor !== null ||
    lot.netCapitalMinor !== null
      ? lot
      : {
          ...lot,
          grossCashMinor: economics.committedMinor,
          netCapitalMinor: economics.positionCostBasisMinor,
          upfrontDeductionsMinor: Number(
            BigInt(economics.committedMinor) -
              BigInt(economics.positionCostBasisMinor),
          ),
        },
  );
}

function integer(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("Purchase calculation exceeds supported precision.");
  return n;
}
function ratio(a: number, b: bigint, d: bigint) {
  return integer((BigInt(a) * b + d / 2n) / d);
}
export function purchaseCapital(
  lot: Pick<
    PurchaseLot,
    | "grossCashMinor"
    | "netCapitalMinor"
    | "feePpm"
    | "feeBasis"
    | "upfrontDeductionsMinor"
    | "capitalReturn"
  >,
) {
  const refund =
    lot.capitalReturn?.status === "received"
      ? lot.capitalReturn.amountMinor
      : 0;
  const retained =
    lot.grossCashMinor === null
      ? null
      : Number(BigInt(lot.grossCashMinor) - BigInt(refund));
  if (retained !== null && retained < 0)
    return {
      grossCashMinor: lot.grossCashMinor,
      netCapitalMinor: lot.netCapitalMinor,
      upfrontDeductionsMinor: lot.upfrontDeductionsMinor ?? null,
      conflict: true,
    };
  if (lot.upfrontDeductionsMinor !== undefined || lot.capitalReturn) {
    const capital = reconcileInvestmentCapital({
      grossCashMinor: retained,
      netCapitalMinor: lot.netCapitalMinor,
      upfrontDeductionsMinor: lot.upfrontDeductionsMinor ?? null,
    });
    return {
      ...capital,
      grossCashMinor:
        capital.grossCashMinor === null
          ? null
          : integer(BigInt(capital.grossCashMinor) + BigInt(refund)),
    };
  }
  let net = lot.netCapitalMinor;
  let gross = retained;
  let conflict = false;
  const rate = lot.feePpm;
  if (rate !== null && lot.feeBasis !== null) {
    if (lot.feeBasis === "net_capital") {
      if (net === null && gross !== null)
        net = ratio(gross, 1_000_000n, 1_000_000n + BigInt(rate));
      if (net !== null) {
        const computed = integer(
          BigInt(net) + BigInt(ratio(net, BigInt(rate), 1_000_000n)),
        );
        conflict =
          gross !== null &&
          (BigInt(computed) - BigInt(gross) > 1n ||
            BigInt(gross) - BigInt(computed) > 1n);
        gross ??= computed;
      }
    } else {
      if (gross !== null) {
        const computed = integer(
          BigInt(gross) - BigInt(ratio(gross, BigInt(rate), 1_000_000n)),
        );
        conflict =
          net !== null &&
          (BigInt(computed) - BigInt(net) > 1n ||
            BigInt(net) - BigInt(computed) > 1n);
        net ??= computed;
      }
    }
  }
  return {
    netCapitalMinor: net,
    grossCashMinor:
      gross === null ? null : integer(BigInt(gross) + BigInt(refund)),
    upfrontDeductionsMinor:
      gross !== null && net !== null
        ? Number(BigInt(gross) - BigInt(net))
        : null,
    conflict,
  };
}

// A rate can preview a purchase's economics without inventing an executed
// allocation. This result never supplies reviewed capital or underlying shares.
export function estimatePurchaseCapital(lot: PurchaseLot) {
  const exact = purchaseCapital(lot);
  if (
    exact.conflict ||
    exact.netCapitalMinor !== null ||
    lot.grossCashMinor === null ||
    lot.feePpm === null ||
    lot.feeBasis === null
  )
    return null;
  const retained = Number(
    BigInt(lot.grossCashMinor) - BigInt(lot.capitalReturn?.amountMinor ?? 0),
  );
  if (retained < 0) return null;
  const net =
    lot.feeBasis === "gross_cash"
      ? integer(
          BigInt(retained) -
            BigInt(ratio(retained, BigInt(lot.feePpm), 1_000_000n)),
        )
      : ratio(retained, 1_000_000n, 1_000_000n + BigInt(lot.feePpm));
  return {
    retainedCashMinor: retained,
    upfrontDeductionsMinor: integer(BigInt(retained) - BigInt(net)),
    netCapitalMinor: net,
    expectedRefund: lot.capitalReturn?.status === "expected",
  };
}
export function purchaseShares(lot: PurchaseLot) {
  if (lot.remainingSharesMicros !== null)
    return { quantityMicros: lot.remainingSharesMicros, derived: false };
  if (!lot.originalSharesUnchanged) return null;
  const net = purchaseCapital(lot).netCapitalMinor;
  return net !== null && lot.priceMicros !== null
    ? derivedPurchaseShares(net, lot.priceMicros)
    : null;
}
export const ShareValueEstimateSchema = z.object({
  valueMinor: money,
  effectiveDate: z.iso.date().nullable(),
  proxy: z.boolean().default(false),
  derivedShares: z.boolean(),
  grossCashMinor: money.nullable(),
  lots: z.array(
    z.object({
      id: z.string(),
      quantityMicros: money,
      priceMicros: positive,
      valueMinor: money,
      sourceLabel: text,
      effectiveDate: z.iso.date().nullable(),
    }),
  ),
});
export function estimatePurchaseValue(
  receipt: PurchaseReceipt | null | undefined,
  snapshotId: string,
) {
  if (
    !receipt ||
    (receipt.details.investmentSnapshotId ?? receipt.snapshotId) !==
      snapshotId ||
    !receipt.details.coversPosition ||
    receipt.details.lots.length === 0
  )
    return null;
  const latestStockDistribution = receipt.details.distributionReview?.events
    .filter((event) => event.kind === "in_kind")
    .map((event) => event.receivedOn)
    .sort()
    .at(-1);
  if (
    latestStockDistribution &&
    receipt.details.lots.some(
      (lot) => !lot.sharesAsOf || lot.sharesAsOf < latestStockDistribution,
    )
  )
    return null;
  const rows = [];
  let derivedShares = false;
  let gross = 0n;
  let allGross = true;
  for (const lot of receipt.details.lots) {
    const shares = purchaseShares(lot);
    // Use matching securities unless the recorded review explicitly chose a proxy.
    if (
      !shares ||
      !lot.mark ||
      !lot.shareClass ||
      !lot.sourceLabel ||
      (!lot.mark.proxy &&
        (!lot.mark.effectiveDate ||
          lot.shareClass.toLowerCase() !== lot.mark.shareClass?.toLowerCase()))
    )
      return null;
    if (
      lot.sharesAsOf &&
      lot.mark.effectiveDate &&
      lot.sharesAsOf > lot.mark.effectiveDate
    )
      return null;
    derivedShares ||= shares.derived;
    const cash = purchaseCapital(lot).grossCashMinor;
    if (cash === null) allGross = false;
    else gross += BigInt(cash);
    rows.push({
      id: lot.id,
      quantityMicros: shares.quantityMicros,
      priceMicros: lot.mark.priceMicros,
      valueMinor: ratio(
        shares.quantityMicros,
        BigInt(lot.mark.priceMicros),
        10_000_000_000n,
      ),
      sourceLabel: lot.mark.sourceLabel,
      effectiveDate: lot.mark.effectiveDate,
    });
  }
  return ShareValueEstimateSchema.parse({
    valueMinor: integer(
      rows.reduce((n, row) => n + BigInt(row.valueMinor), 0n),
    ),
    effectiveDate: rows.some((row) => row.effectiveDate === null)
      ? null
      : rows.map((row) => row.effectiveDate).sort()[0],
    proxy: receipt.details.lots.some((lot) => Boolean(lot.mark?.proxy)),
    derivedShares,
    grossCashMinor: allGross ? integer(gross) : null,
    lots: rows,
  });
}

function derivedPurchaseShares(net: number, price: number) {
  const quantity =
    (BigInt(net) * 10_000_000_000n + BigInt(price) / 2n) / BigInt(price);
  return quantity <= 1_000_000_000_000n
    ? { quantityMicros: Number(quantity), derived: true }
    : null;
}

export function purchaseAllInPrice(lot: PurchaseLot): number | null {
  if (lot.priceMicros === null) return null;
  let numerator: bigint, denominator: bigint;
  if (
    lot.upfrontDeductionsMinor === undefined &&
    lot.feePpm !== null &&
    lot.feeBasis !== null
  ) {
    numerator =
      lot.feeBasis === "net_capital"
        ? 1_000_000n + BigInt(lot.feePpm)
        : 1_000_000n;
    denominator =
      lot.feeBasis === "net_capital"
        ? 1_000_000n
        : 1_000_000n - BigInt(lot.feePpm);
  } else {
    const capital = purchaseCapital(lot);
    if (capital.grossCashMinor === null || capital.netCapitalMinor === null)
      return null;
    numerator =
      BigInt(capital.grossCashMinor) -
      BigInt(
        lot.capitalReturn?.status === "received"
          ? lot.capitalReturn.amountMinor
          : 0,
      );
    denominator = BigInt(capital.netCapitalMinor);
  }
  if (denominator <= 0n) return null;
  const value =
    (BigInt(lot.priceMicros) * numerator + denominator / 2n) / denominator;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export const SharePriceEvidenceSchema = z.object({
  sourceMetadata: SourcePriceMetadataSchema.nullable().optional(),
  shareBasis: ShareBasisSchema.nullable().optional(),
  priceSourcePositionId: text.optional(),
  id: text,
  positionId: text,
  positionLabel: text,
  sourceLabel: text,
  observedAt: z.string().min(1),
  capturedAt: z.iso.datetime(),
  costMicros: positive.nullable(),
  markMicros: positive.nullable(),
  markDate: z.iso.date().nullable(),
  shareClass: text.nullable(),
});
export const SharePriceEvidenceListSchema = z
  .array(SharePriceEvidenceSchema)
  .max(120);

export const PositionValuationEvidenceSchema = z.object({
  prices: SharePriceEvidenceListSchema,
  watch: z
    .array(
      z.object({
        id: text,
        title: z.string().min(1),
        url: z.url().refine((value) => new URL(value).protocol === "https:"),
        publishedAt: z.string().min(1),
        fact: z.string(),
      }),
    )
    .max(10),
});

// A current head is already loaded with the position: no additional read needed.
export function reviewedInvestmentFromReceipt(
  receipt: PurchaseReceipt | null | undefined,
): ReviewedInvestment | undefined {
  if (
    !receipt ||
    (!receipt.details.investmentTerms && !receipt.details.distributionReview)
  )
    return undefined;
  const capital = receipt.details.lots.map(purchaseCapital);
  const estimatedCapital = receipt.details.lots.map((lot, index) => {
    if (capital[index]!.conflict) return null;
    if (capital[index]!.netCapitalMinor !== null)
      return capital[index]!.netCapitalMinor;
    const fees = purchaseFeeSummary(lot);
    if (!fees || lot.grossCashMinor === null) return null;
    const net =
      BigInt(lot.grossCashMinor) -
      BigInt(
        lot.capitalReturn?.status === "received"
          ? lot.capitalReturn.amountMinor
          : 0,
      ) -
      BigInt(fees.amountMinor);
    return net >= 0n ? integer(net) : null;
  });
  const sum = (
    key: "grossCashMinor" | "netCapitalMinor" | "upfrontDeductionsMinor",
  ) => {
    if (
      !receipt.details.cashCoversPosition ||
      !capital.length ||
      capital.some((row) => row.conflict || row[key] === null)
    )
      return null;
    const total = capital.reduce((total, row) => total + BigInt(row[key]!), 0n);
    return total > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(total);
  };
  const separateFees = receipt.details.lots.flatMap((lot) =>
    (lot.fees ?? []).filter(
      (fee) => fee.treatment === "separate" && fee.paymentStatus === "paid",
    ),
  );
  const additionalPaidFeesMinor = separateFees.some(
    (fee) => fee.method !== "paid" || fee.paidMinor === null,
  )
    ? null
    : Number(
        separateFees.reduce((sum, fee) => sum + BigInt(fee.paidMinor!), 0n),
      );
  const cashContributed = sum("grossCashMinor");
  const returnedCapital = receipt.details.lots.reduce(
    (total, lot) =>
      total +
      (lot.capitalReturn?.status === "received"
        ? BigInt(lot.capitalReturn.amountMinor)
        : 0n),
    0n,
  );
  const additionalReturnedCapital = receipt.details.lots.reduce(
    (total, lot) =>
      total +
      (lot.capitalReturn?.status === "received" &&
      lot.capitalReturn.reportedDistributions === "excluded"
        ? BigInt(lot.capitalReturn.amountMinor)
        : 0n),
    0n,
  );
  const includedReturnedCapital = receipt.details.lots.reduce(
    (total, lot) =>
      total +
      (lot.capitalReturn?.status === "received" &&
      lot.capitalReturn.reportedDistributions === "included"
        ? BigInt(lot.capitalReturn.amountMinor)
        : 0n),
    0n,
  );
  return {
    ...(receipt.details.valuation?.records.some(
      (r) =>
        r.id === receipt.details.valuation?.selected?.recordId &&
        r.followSource,
    )
      ? { appliesUntilSuperseded: true as const }
      : {}),
    snapshotId: receipt.details.investmentSnapshotId ?? receipt.snapshotId,
    receiptId: receipt.id,
    terms: receipt.details.investmentTerms ?? unknownInvestmentTerms(),
    ...(receipt.details.distributionReview
      ? { distributionReview: receipt.details.distributionReview }
      : {}),
    additionalPaidFeesMinor,
    cashPaidMinor:
      cashContributed !== null && additionalPaidFeesMinor !== null
        ? Number(BigInt(cashContributed) + BigInt(additionalPaidFeesMinor))
        : null,
    netCapitalMinor: sum("netCapitalMinor"),
    estimatedNetCapitalMinor:
      !receipt.details.cashCoversPosition ||
      !estimatedCapital.length ||
      estimatedCapital.some((amount) => amount === null)
        ? null
        : integer(
            estimatedCapital.reduce<bigint>(
              (sum, amount) => sum + BigInt(amount!),
              0n,
            ),
          ),
    upfrontDeductionsMinor: sum("upfrontDeductionsMinor"),
    ...(receipt.details.lots.some((lot) => lot.capitalReturn)
      ? {
          returnedCapitalMinor: integer(returnedCapital),
          additionalReturnedCapitalMinor: integer(additionalReturnedCapital),
          includedReturnedCapitalMinor: integer(includedReturnedCapital),
          returnedCapitalReconciliationPending: receipt.details.lots.some(
            (lot) =>
              lot.capitalReturn?.status === "received" &&
              lot.capitalReturn.reportedDistributions === "unknown",
          ),
        }
      : {}),
  };
}
