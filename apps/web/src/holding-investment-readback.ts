import type { Holding } from "@keel/domain";
import {
  purchaseCapital,
  purchaseShares,
  type PurchaseLot,
} from "@keel/domain/position-purchases";
import {
  investmentFeeAmount,
  type InvestmentFee,
} from "@keel/domain/investment-fees";

export const blankFee = (kind: InvestmentFee["kind"]): InvestmentFee => ({
  id: crypto.randomUUID(),
  kind,
  coveredLotIds: [],
  paymentStatus: "paid",
  treatment: "upfront",
  dueDate: null,
  label:
    kind === "management"
      ? "Management fee"
      : kind === "one_time"
        ? "One-time fee"
        : "Upfront fees",
  method: "paid",
  paidMinor: null,
  ratePpm: null,
  basis: "unknown",
  basisMinor: null,
  prepaidMonths: null,
});
export function feesFor(lot: PurchaseLot): InvestmentFee[] {
  if (lot.fees) return lot.fees;
  const capital = purchaseCapital(lot);
  const fee = blankFee(
    lot.feeLabel?.toLowerCase().includes("management")
      ? "management"
      : "one_time",
  );
  fee.id = `${lot.id}-upfront`;
  fee.label = lot.feeLabel ?? "Upfront fees";
  fee.paidMinor = capital.upfrontDeductionsMinor;
  fee.ratePpm = lot.feePpm;
  fee.basis =
    lot.feeBasis === "gross_cash"
      ? "retained"
      : lot.feeBasis === "net_capital"
        ? "net_capital"
        : "unknown";
  if (fee.paidMinor === null && fee.ratePpm !== null) fee.method = "percentage";
  return fee.paidMinor !== null || fee.ratePpm !== null ? [fee] : [];
}
export function visibleInvestmentFees(lot: PurchaseLot) {
  return feesFor(lot)
    .filter((fee) => fee.paymentStatus !== "unpaid")
    .flatMap((fee) => {
      const amount = investmentFeeAmount(fee, {
        grossCashMinor: lot.grossCashMinor,
        refundMinor:
          lot.capitalReturn?.status === "received"
            ? lot.capitalReturn.amountMinor
            : 0,
        netCapitalMinor: lot.netCapitalMinor,
      });
      return amount === 0 || (amount === null && fee.ratePpm === null)
        ? []
        : [{ fee, amount }];
    });
}

export function holdingInvestmentHasReadbackFacts(
  holding: Holding,
  omitCashPaid = false,
) {
  const receipt = holding.purchaseContext?.receipt;
  const terms = receipt?.details.investmentTerms;
  return (
    terms?.carryPpm != null ||
    terms?.annualManagementFeePpm != null ||
    Boolean(
      receipt?.details.lots.some(
        (lot) =>
          (!omitCashPaid && lot.grossCashMinor !== null) ||
          lot.purchasedOn !== null ||
          lot.capitalReturn ||
          visibleInvestmentFees(lot).length > 0 ||
          lot.priceMicros !== null ||
          purchaseShares(lot),
      ),
    )
  );
}
