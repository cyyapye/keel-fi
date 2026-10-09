import {
  effectivePositionValuation,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";
import { decimal } from "./decimal-input";
import { formatMoney, formatSharePrice } from "./format";

const differs = (a: unknown, b: unknown) =>
  JSON.stringify(a) !== JSON.stringify(b);

/** Compare saved predecessors; an unavailable predecessor yields a snapshot summary. */
export function holdingHistorySummary(
  receipt: PurchaseReceipt,
  previous: PurchaseReceipt | null,
) {
  const changes: string[] = [];
  for (const [i, lot] of receipt.details.lots.entries()) {
    const prior = previous?.details.lots.find((l) => l.id === lot.id);
    const prefix =
      receipt.details.lots.length > 1 ? `Acquisition ${i + 1}: ` : "";
    if (!prior && previous) changes.push(`${prefix}added`);
    if (
      (!prior || prior.grossCashMinor !== lot.grossCashMinor) &&
      lot.grossCashMinor !== null
    )
      changes.push(`${prefix}Cash paid ${formatMoney(lot.grossCashMinor)}`);
    if (
      differs(prior?.capitalReturn, lot.capitalReturn) &&
      (prior || lot.capitalReturn)
    )
      changes.push(
        `${prefix}${lot.capitalReturn ? `Refund ${formatMoney(lot.capitalReturn.amountMinor)}` : "Refund removed"}`,
      );
    if (prior && prior.priceMicros !== lot.priceMicros)
      changes.push(
        `${prefix}Purchase price${lot.priceMicros !== null ? ` ${formatSharePrice(lot.priceMicros)}` : " cleared"}`,
      );
    if (
      prior &&
      (prior.remainingSharesMicros !== lot.remainingSharesMicros ||
        prior.sharesAsOf !== lot.sharesAsOf)
    )
      changes.push(
        `${prefix}Shares${lot.remainingSharesMicros !== null ? ` ${decimal(lot.remainingSharesMicros, 6)}` : " cleared"}`,
      );
    if (prior && differs(prior.fees, lot.fees)) {
      const changedFees =
        lot.fees?.filter((f) =>
          differs(
            f,
            prior.fees?.find((p) => p.id === f.id),
          ),
        ) ?? [];
      for (const fee of changedFees) {
        const amount = fee.method === "paid" ? fee.paidMinor : fee.ratePpm;
        const duration =
          fee.kind === "management" && fee.prepaidMonths !== null
            ? ` · ${fee.prepaidMonths % 12 === 0 ? `${fee.prepaidMonths / 12} years` : `${fee.prepaidMonths} months`} prepaid`
            : "";
        changes.push(
          `${prefix}${fee.label}${amount !== null ? ` ${fee.method === "paid" ? formatMoney(amount) : `${decimal(amount, 4)}%${fee.kind === "management" ? "/year" : ""}`}` : " updated"}${duration}`,
        );
      }
      if (!changedFees.length) changes.push(`${prefix}Fees updated`);
    }
    if (
      prior &&
      differs(
        [
          prior.netCapitalMinor,
          prior.upfrontDeductionsMinor,
          prior.feePpm,
          prior.feeBasis,
          prior.feesComplete,
        ],
        [
          lot.netCapitalMinor,
          lot.upfrontDeductionsMinor,
          lot.feePpm,
          lot.feeBasis,
          lot.feesComplete,
        ],
      ) &&
      !differs(prior.fees, lot.fees)
    )
      changes.push(`${prefix}Capital / fees updated`);
    if (
      prior &&
      differs(
        [
          prior.purchasedOn,
          prior.shareClass,
          prior.sourceLabel,
          prior.sourceUrl,
          prior.referencePriceMicros,
          prior.mark,
        ],
        [
          lot.purchasedOn,
          lot.shareClass,
          lot.sourceLabel,
          lot.sourceUrl,
          lot.referencePriceMicros,
          lot.mark,
        ],
      )
    )
      changes.push(`${prefix}Purchase details updated`);
  }
  if (
    previous &&
    previous.details.lots.some(
      (lot) => !receipt.details.lots.some((l) => l.id === lot.id),
    )
  )
    changes.push("Acquisition removed");
  const terms = receipt.details.investmentTerms;
  if (previous && differs(terms, previous.details.investmentTerms))
    changes.push(
      differs(
        [terms?.carryPpm, terms?.carryBasis],
        [
          previous.details.investmentTerms?.carryPpm,
          previous.details.investmentTerms?.carryBasis,
        ],
      )
        ? terms?.carryPpm != null
          ? `Carry ${decimal(terms.carryPpm, 4)}%`
          : "Carry cleared"
        : "Terms updated",
    );
  if (
    previous &&
    differs(
      [
        receipt.details.coversPosition,
        receipt.details.cashCoversPosition,
        receipt.details.investmentSnapshotId,
      ],
      [
        previous.details.coversPosition,
        previous.details.cashCoversPosition,
        previous.details.investmentSnapshotId,
      ],
    )
  )
    changes.push("Coverage reviewed");
  const valuationChanged = differs(
    receipt.details.valuation,
    previous?.details.valuation,
  );
  const value = valuationChanged
    ? effectivePositionValuation(receipt, receipt.snapshotId)
    : null;
  const kind =
    [
      changes.length ? "Investment" : null,
      valuationChanged ? "Valuation" : null,
    ]
      .filter(Boolean)
      .join(" & ") || "Investment reviewed";
  if (value)
    changes.push(
      `${value.sourceLabel} ${formatMoney(value.valueMinor)} · ${value.carryStatus === "unknown" ? "carry unknown" : value.carryStatus.replaceAll("_", " ")}`,
    );
  else if (valuationChanged)
    changes.push(
      receipt.details.valuation?.selected
        ? "Valuation updated"
        : "Share calculation cleared",
    );
  return `${kind}${changes.length ? ` · ${changes.slice(0, 3).join(" · ")}${changes.length > 3 ? ` · +${changes.length - 3} changes` : ""}` : ""}`;
}
