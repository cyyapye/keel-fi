import { z } from "zod";
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
    id: z.string().min(1).max(100),
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
    purchasedOn: z.iso.date().nullable(),
    shareClass: text.nullable(),
    priceMicros: positive.nullable(),
    referencePriceMicros: positive.nullable(),
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
        priceMicros: positive,
        effectiveDate: z.iso.date(),
        shareClass: text,
        sourceLabel: text,
        sourceUrl: z.url().max(2048).nullable(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((lot, ctx) => {
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
    if (lot.remainingSharesMicros !== null && lot.sharesAsOf === null)
      ctx.addIssue({
        code: "custom",
        path: ["sharesAsOf"],
        message: "Date the remaining underlying share count.",
      });
    if (lot.mark && lot.purchasedOn && lot.mark.effectiveDate < lot.purchasedOn)
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
        message: "Cash, share capital and the one-time fee do not reconcile.",
      });
  });
export const PurchaseDetailsSchema = z
  .object({
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
  });
export const PurchaseReceiptSchema = z.object({
  id: z.string().min(1),
  positionId: z.string().min(1),
  snapshotId: z.string().min(1),
  currency: z.literal("USD"),
  details: PurchaseDetailsSchema,
  acceptedAt: z.iso.datetime(),
});
export const AcceptPurchasesSchema = z
  .object({
    expectedSnapshotId: z.string().min(1),
    expectedReceiptId: z.string().min(1).nullable(),
    details: PurchaseDetailsSchema,
  })
  .strict();
export const PurchaseContextSchema = z.object({
  snapshotId: z.string().min(1),
  currency: z.literal("USD"),
  openedOn: z.iso.date().nullable(),
  receipt: PurchaseReceiptSchema.nullable(),
});
export type PurchaseLot = z.infer<typeof PurchaseLotSchema>;
export type PurchaseReceipt = z.infer<typeof PurchaseReceiptSchema>;
export type AcceptPurchases = z.infer<typeof AcceptPurchasesSchema>;

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
    if (lot.grossCashMinor !== null || lot.netCapitalMinor !== null) return lot;
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
    "grossCashMinor" | "netCapitalMinor" | "feePpm" | "feeBasis"
  >,
) {
  let net = lot.netCapitalMinor;
  let gross = lot.grossCashMinor;
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
  return { netCapitalMinor: net, grossCashMinor: gross, conflict };
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
  effectiveDate: z.iso.date(),
  derivedShares: z.boolean(),
  grossCashMinor: money.nullable(),
  lots: z.array(
    z.object({
      id: z.string(),
      quantityMicros: money,
      priceMicros: positive,
      valueMinor: money,
      sourceLabel: text,
      effectiveDate: z.iso.date(),
    }),
  ),
});
export function estimatePurchaseValue(
  receipt: PurchaseReceipt | null | undefined,
  snapshotId: string,
) {
  if (
    !receipt ||
    receipt.snapshotId !== snapshotId ||
    !receipt.details.coversPosition ||
    receipt.details.lots.length === 0
  )
    return null;
  const rows = [];
  let derivedShares = false;
  let gross = 0n;
  let allGross = true;
  for (const lot of receipt.details.lots) {
    const shares = purchaseShares(lot);
    // A price must explicitly describe the same security, not merely the same company.
    if (
      !shares ||
      !lot.mark ||
      !lot.shareClass ||
      !lot.sourceLabel ||
      lot.shareClass.toLowerCase() !== lot.mark.shareClass.toLowerCase()
    )
      return null;
    if (lot.sharesAsOf && lot.sharesAsOf > lot.mark.effectiveDate) return null;
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
    effectiveDate: rows.map((row) => row.effectiveDate).sort()[0],
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
  if (lot.feePpm !== null && lot.feeBasis !== null) {
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
    numerator = BigInt(capital.grossCashMinor);
    denominator = BigInt(capital.netCapitalMinor);
  }
  if (denominator <= 0n) return null;
  const value =
    (BigInt(lot.priceMicros) * numerator + denominator / 2n) / denominator;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

export const SharePriceEvidenceSchema = z.object({
  id: text,
  positionId: text,
  positionLabel: text,
  sourceLabel: text,
  observedAt: z.string().min(1),
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
