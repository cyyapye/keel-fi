import {
  estimatePurchaseCapital,
  purchaseFeeSummary,
  purchaseCapital,
  type PurchaseLot,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";

export type CapitalSummary = {
  amountMinor: number | null;
  upfrontFeesMinor: number | null;
  kind: "net" | "estimated_net" | "before_fees";
  assumedFeeBasis: boolean;
};

export const capitalSummaryLabel = (summary: CapitalSummary) =>
  summary.kind === "net"
    ? "Net invested"
    : summary.kind === "estimated_net"
      ? "Estimated net invested"
      : "Cash retained · includes fees";

/** Display only. Estimated capital never supplies accepted capital or shares. */
export function purchaseCapitalSummary(lot: PurchaseLot): CapitalSummary {
  const capital = purchaseCapital(lot);
  if (capital.conflict)
    return {
      amountMinor: null,
      upfrontFeesMinor: null,
      kind: "before_fees",
      assumedFeeBasis: false,
    };
  if (capital.netCapitalMinor !== null)
    return {
      amountMinor: capital.netCapitalMinor,
      upfrontFeesMinor: capital.upfrontDeductionsMinor,
      kind: "net",
      assumedFeeBasis: false,
    };
  const fees = purchaseFeeSummary(lot);
  if (fees && lot.grossCashMinor !== null) {
    const net =
      BigInt(lot.grossCashMinor) -
      BigInt(
        lot.capitalReturn?.status === "received"
          ? lot.capitalReturn.amountMinor
          : 0,
      ) -
      BigInt(fees.amountMinor);
    if (net >= 0n)
      return {
        amountMinor: Number(net),
        upfrontFeesMinor: fees.amountMinor,
        kind: fees.estimated ? "estimated_net" : "net",
        assumedFeeBasis: false,
      };
  }
  // Received cash alone reduces current capital. A promised refund does not.
  const received =
    lot.capitalReturn?.status === "received" ? lot.capitalReturn : undefined;
  const estimate =
    lot.feePpm !== null
      ? estimatePurchaseCapital({
          ...lot,
          capitalReturn: received,
          upfrontDeductionsMinor: null,
          // Deducting a rate from retained cash gives a lower net amount than
          // treating the same rate as a markup on net share capital.
          feeBasis: lot.feeBasis ?? "gross_cash",
        })
      : null;
  if (estimate)
    return {
      amountMinor: estimate.netCapitalMinor,
      upfrontFeesMinor: estimate.upfrontDeductionsMinor,
      kind: "estimated_net",
      assumedFeeBasis: lot.feeBasis === null && (lot.feePpm ?? 0) > 0,
    };
  return {
    amountMinor:
      capital.grossCashMinor === null
        ? null
        : Number(
            BigInt(capital.grossCashMinor) - BigInt(received?.amountMinor ?? 0),
          ),
    upfrontFeesMinor: capital.upfrontDeductionsMinor,
    kind: "before_fees",
    assumedFeeBasis: false,
  };
}

export function positionCapitalSummary(
  receipt: PurchaseReceipt | null | undefined,
  snapshotId: string | undefined,
): CapitalSummary | null {
  if (
    !receipt ||
    (!receipt.details.valuation?.records.some(
      (r) =>
        r.id === receipt.details.valuation?.selected?.recordId &&
        r.followSource,
    ) &&
      (receipt.snapshotId !== snapshotId ||
        (receipt.details.investmentSnapshotId ?? receipt.snapshotId) !==
          snapshotId)) ||
    !receipt.details.cashCoversPosition ||
    !receipt.details.lots.length
  )
    return null;
  const summaries = receipt.details.lots.map(purchaseCapitalSummary);
  const total = (key: "amountMinor" | "upfrontFeesMinor") =>
    summaries.some((row) => row[key] === null)
      ? null
      : Number(summaries.reduce((sum, row) => sum + BigInt(row[key]!), 0n));
  return {
    amountMinor: total("amountMinor"),
    upfrontFeesMinor: total("upfrontFeesMinor"),
    kind: summaries.some((row) => row.kind === "before_fees")
      ? "before_fees"
      : summaries.some((row) => row.kind === "estimated_net")
        ? "estimated_net"
        : "net",
    assumedFeeBasis: summaries.some((row) => row.assumedFeeBasis),
  };
}
