import type { PurchaseReceipt } from "./position-purchases";
import type { PositionEconomicsContext } from "./position-economics";

/** Reuse explicit terms from a single current purchase; multiple lots need review. */
export function purchaseEconomicsEvidence(
  context: PositionEconomicsContext,
  receipt: PurchaseReceipt | null | undefined,
) {
  const current = receipt?.snapshotId === context.snapshotId;
  const lot =
    current && receipt.details.lots.length === 1
      ? receipt.details.lots[0]!
      : null;
  const management = lot?.reportedManagementFeePpm ?? null;
  const carry = lot?.reportedCarryPpm ?? null;
  const provider = context.reportedTerms;
  const conflicts = [
    management !== null &&
    provider?.managementFeePpm != null &&
    management !== provider.managementFeePpm
      ? "management fee"
      : null,
    carry !== null && provider?.carryPpm != null && carry !== provider.carryPpm
      ? "carry"
      : null,
  ].filter((value): value is string => value !== null);
  return {
    managementFeePpm: conflicts.includes("management fee")
      ? null
      : (management ?? provider?.managementFeePpm ?? null),
    carryPpm: conflicts.includes("carry")
      ? null
      : (carry ?? provider?.carryPpm ?? null),
    conflicts,
    purchaseManagementFeePpm: management,
    purchaseCarryPpm: carry,
    sourceLabel: [
      ...new Set([lot?.sourceLabel, provider?.sourceLabel].filter(Boolean)),
    ].join(" and "),
    purchaseFee:
      lot?.feePpm != null && lot.feeBasis != null
        ? {
            receiptId: receipt!.id,
            ratePpm: lot.feePpm,
            basis: lot.feeBasis,
            label: lot.feeLabel ?? "Underlying purchase fee",
          }
        : null,
  };
}
