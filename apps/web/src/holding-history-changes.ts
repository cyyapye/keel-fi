import type { PurchaseReceipt } from "@keel/domain/position-purchases";
import { decimal } from "./decimal-input";
import { formatDate, formatMoney, formatSharePrice } from "./format";

type Fact = { label: string; value: string };
const words = (value: string) =>
  ({
    gross_cash: "Cash paid",
    net_capital: "Net capital",
    cash: "Cash paid",
    retained: "Cash after refund",
    percentage: "Percentage",
    paid: "Paid amount",
    before_carry: "Before carry",
    after_carry: "After carry",
    unknown: "Unknown",
    total: "Position total",
    shares: "Share calculation",
    gp: "Reported",
    mine: "My estimate",
    proxy: "Proxy estimate",
  })[value] ?? value.replaceAll("_", " ");

function facts(receipt: PurchaseReceipt | null, multiple: boolean) {
  const result = new Map<string, Fact>();
  if (!receipt) return result;
  const put = (
    key: string,
    label: string,
    value: unknown,
    format: (v: never) => string = (v) =>
      typeof v === "boolean" ? (v ? "Yes" : "No") : words(String(v)),
  ) => {
    if (value !== null && value !== undefined && value !== "")
      result.set(key, { label, value: format(value as never) });
  };
  const { details } = receipt;
  const review = details.distributionReview;
  if (review) {
    put(
      "distributions:method",
      "Distribution carry calculation",
      "Capital returned first",
    );
    put(
      "distributions:coverage",
      "Distribution history",
      review.coverage.status === "complete"
        ? "All received distributions recorded"
        : "Only some distributions recorded",
    );
    put(
      "distributions:through",
      "History through",
      review.coverage.throughDate,
      formatDate,
    );
    put(
      "distributions:priorCarry",
      "Carry already charged",
      review.priorCarry.status === "known"
        ? formatMoney(review.priorCarry.amountMinor)
        : "Unknown",
    );
    put(
      "distributions:inclusion",
      "Recorded distributions in provider total",
      {
        all: "Already included",
        none: "Not included",
        unknown: "Unknown",
        unsupported_mixed: "Mixed · only some included",
      }[review.provider.inclusion],
    );
    put(
      "distributions:provider",
      "Provider-reported distributions",
      review.provider.realizedValueMinor,
      formatMoney,
    );
    put(
      "distributions:source",
      "Distribution review evidence",
      review.sourceLabel,
    );
    put(
      "distributions:url",
      "Distribution review source link",
      review.sourceUrl,
    );
    put("distributions:note", "Distribution review note", review.note);
    for (const [i, event] of review.events.entries()) {
      const key = `distribution:${event.id}:`;
      const label = `Distribution ${i + 1} · `;
      put(
        key + "kind",
        label + "Received as",
        event.kind === "cash" ? "Cash" : "Stock",
      );
      put(key + "date", label + "Received on", event.receivedOn, formatDate);
      put(
        key + "amount",
        label + "Historical investor value",
        event.investorValueMinor === null
          ? "Unknown"
          : formatMoney(event.investorValueMinor),
      );
      if (event.kind === "in_kind") {
        put(key + "security", label + "Security received", event.securityLabel);
        put(
          key + "quantity",
          label + "Shares received",
          event.quantityMicros,
          (value) => decimal(value, 6),
        );
      }
      put(key + "source", label + "Evidence", event.sourceLabel);
      put(key + "url", label + "Source link", event.sourceUrl);
      put(key + "note", label + "Note", event.note);
    }
  }

  for (const [i, lot] of details.lots.entries()) {
    const key = `lot:${lot.id}:`;
    const label = multiple ? `Acquisition ${i + 1} · ` : "";
    const field = (
      name: string,
      title: string,
      value: unknown,
      format?: (v: never) => string,
    ) => put(key + name, label + title, value, format);
    field("cash", "Cash paid", lot.grossCashMinor, formatMoney);
    field("net", "Confirmed net capital", lot.netCapitalMinor, formatMoney);
    field(
      "deductions",
      "Upfront fees paid",
      lot.upfrontDeductionsMinor,
      formatMoney,
    );
    field("date", "Purchase date", lot.purchasedOn, formatDate);
    field("class", "Share class", lot.shareClass);
    field(
      "price",
      "Purchase price",
      lot.priceMicros,
      (v) => `${formatSharePrice(v)}/share`,
    );
    field("shares", "Shares", lot.remainingSharesMicros, (v) => decimal(v, 6));
    field("sharesDate", "Shares as of", lot.sharesAsOf, formatDate);
    field("quantityStatus", "Quantity status", lot.quantityDetails?.status);
    field(
      "quantityDerivation",
      "Quantity derivation",
      lot.quantityDetails?.derivation,
    );
    field(
      "quantityEvidence",
      "Quantity evidence",
      lot.quantityDetails?.evidence,
    );
    field(
      "quantityBasis",
      "Shares per original share",
      lot.quantityDetails?.shareBasis.unitsPerOriginal,
    );
    field(
      "unchangedShares",
      "Original shares still held",
      lot.originalSharesUnchanged,
    );
    field("units", "SPV units", lot.nominalSpvUnitsMicros, (v) =>
      decimal(v, 6),
    );
    field("source", "Purchase source", lot.sourceLabel);
    field("url", "Purchase source link", lot.sourceUrl);
    field("sourceKind", "Purchase source type", lot.sourceKind);
    field(
      "sourceDate",
      "Purchase source date",
      lot.sourceObservedOn,
      formatDate,
    );
    field("sourceText", "Source terms", lot.sourceText);
    field("transaction", "Transaction type", lot.transactionType);
    field("referenceRound", "Reference round", lot.referenceRound);
    field(
      "referencePrice",
      "Reference price",
      lot.referencePriceMicros,
      formatSharePrice,
    );
    field(
      "premium",
      "Reported premium",
      lot.reportedPremiumPpm,
      (v) => `${decimal(v, 4)}%`,
    );
    field(
      "management",
      "Reported management fee",
      lot.reportedManagementFeePpm,
      (v) => `${decimal(v, 4)}%/year`,
    );
    field(
      "carry",
      "Reported carry",
      lot.reportedCarryPpm,
      (v) => `${decimal(v, 4)}%`,
    );
    field("feesComplete", "All upfront fees recorded", lot.feesComplete);
    field(
      "legacyFee",
      lot.feeLabel ?? "One-time fee",
      lot.feePpm,
      (v) => `${decimal(v, 4)}%`,
    );
    field("legacyFeeBasis", "One-time fee basis", lot.feeBasis);
    if (lot.capitalReturn) {
      field(
        "refund",
        "Capital refund",
        lot.capitalReturn.amountMinor,
        formatMoney,
      );
      field("refundStatus", "Refund status", lot.capitalReturn.status);
      field(
        "refundDate",
        "Refund date",
        lot.capitalReturn.effectiveDate,
        formatDate,
      );
      field(
        "refundIncluded",
        "Refund in reported distributions",
        lot.capitalReturn.reportedDistributions,
      );
    }
    for (const fee of lot.fees ?? []) {
      const feeKey = `${key}fee:${fee.id}:`;
      const feeLabel = label + fee.label;
      put(feeKey + "label", label + "Fee name", fee.label);
      put(feeKey + "method", feeLabel + " · Entry", fee.method);
      put(feeKey + "amount", feeLabel + " · Paid", fee.paidMinor, formatMoney);
      put(
        feeKey + "rate",
        feeLabel + " · Rate",
        fee.ratePpm,
        (v) => `${decimal(v, 4)}%${fee.kind === "management" ? "/year" : ""}`,
      );
      put(feeKey + "basis", feeLabel + " · Basis", fee.basis);
      put(
        feeKey + "basisAmount",
        feeLabel + " · Basis amount",
        fee.basisMinor,
        formatMoney,
      );
      put(
        feeKey + "prepaid",
        feeLabel + " · Prepaid",
        fee.prepaidMonths,
        (v) => `${String(v)} months`,
      );
      put(feeKey + "treatment", feeLabel + " · Payment", fee.treatment);
      put(feeKey + "status", feeLabel + " · Payment status", fee.paymentStatus);
      put(feeKey + "due", feeLabel + " · Due", fee.dueDate, formatDate);
      put(
        feeKey + "coverage",
        feeLabel + " · Acquisitions covered",
        fee.coveredLotIds.length
          ? fee.coveredLotIds
              .map((id) => details.lots.findIndex((l) => l.id === id) + 1)
              .join(", ")
          : null,
      );
    }
    if (lot.mark) {
      field(
        "markPrice",
        "Valuation price",
        lot.mark.priceMicros,
        formatSharePrice,
      );
      field("markDate", "Valuation date", lot.mark.effectiveDate, formatDate);
      field("markClass", "Valuation share class", lot.mark.shareClass);
      field("markSource", "Valuation source", lot.mark.sourceLabel);
      field("markUrl", "Valuation source link", lot.mark.sourceUrl);
    }
  }
  const terms = details.investmentTerms;
  if (terms) {
    put("terms:carry", "Carry", terms.carryPpm, (v) => `${decimal(v, 4)}%`);
    put("terms:carryBasis", "Carry gains above", terms.carryBasis);
    put(
      "terms:management",
      "Annual management fee",
      terms.annualManagementFeePpm,
      (v) => `${decimal(v, 4)}%/year`,
    );
    put(
      "terms:managementBasis",
      "Annual management fee basis",
      terms.annualManagementBasis,
    );
    put(
      "terms:amountBasis",
      "Imported amount basis",
      terms.importedAmountBasis,
    );
    put("terms:note", "Terms note", terms.note);
    if (terms.reportedValueReview) {
      put(
        "terms:value",
        "Reported value",
        terms.reportedValueReview.valueMinor,
        formatMoney,
      );
      put(
        "terms:valueSource",
        "Reported value source",
        terms.reportedValueReview.sourceLabel,
      );
      put(
        "terms:valueDate",
        "Reported value date",
        terms.reportedValueReview.effectiveDate,
        formatDate,
      );
      put(
        "terms:valueCarry",
        "Reported value carry",
        terms.reportedValueReview.carryStatus,
      );
    }
  }
  put(
    "coverage:cash",
    "All contributions recorded",
    details.cashCoversPosition,
  );
  put("coverage:shares", "All shares recorded", details.coversPosition);
  const valuation = details.valuation;
  for (const record of valuation?.records ?? []) {
    const key = `value:${record.id}:`;
    const label = `${record.sourceLabel} · `;
    put(key + "source", "Valuation source", record.sourceLabel);
    put(key + "origin", label + "Type", record.origin);
    put(
      key + "total",
      label + "Position total",
      record.totalMinor,
      formatMoney,
    );
    put(
      key + "price",
      label + "Share price",
      record.priceMicros,
      (v) => `${formatSharePrice(v)}/share`,
    );
    put(
      key + "date",
      label + "Valuation date",
      record.effectiveDate,
      formatDate,
    );
    put(
      key + "priceDate",
      label + "Share price date",
      record.priceDate,
      formatDate,
    );
    put(key + "class", label + "Share class", record.shareClass);
    put(
      key + "basis",
      label + "Price units per original share",
      record.shareBasis?.unitsPerOriginal,
    );
    put(key + "follow", label + "Follows accepted prices", record.followSource);
    put(
      key + "crossClass",
      label + "Indicative cross-class proxy",
      record.crossClassProxy,
    );
    put(key + "carry", label + "Carry", record.carryStatus);
    put(key + "url", label + "Source link", record.sourceUrl);
    put(key + "captured", label + "Source captured", record.sourceCapturedAt);
  }
  if (valuation?.calculation) {
    put(
      "calculation:value",
      "Gross proxy value",
      valuation.calculation.valueMinor,
      formatMoney,
    );
    put(
      "calculation:shares",
      "Shares in price basis",
      valuation.calculation.quantityMicros,
      (v) => decimal(v, 6),
    );
    put(
      "calculation:estimated",
      "Estimated shares",
      valuation.calculation.estimatedShares,
    );
  }
  if (valuation?.selected) {
    const record = valuation.records.find(
      (r) => r.id === valuation.selected!.recordId,
    );
    put("selected:source", "Selected valuation", record?.sourceLabel);
    put("selected:method", "Valuation calculation", valuation.selected.method);
  }
  return result;
}

/** Display financial/user-visible deltas; saved snapshots remain immutable. */
export function holdingHistoryChanges(
  receipt: PurchaseReceipt,
  previous: PurchaseReceipt | null,
) {
  const multiple =
    Math.max(receipt.details.lots.length, previous?.details.lots.length ?? 0) >
    1;
  const before = facts(previous, multiple),
    after = facts(receipt, multiple);
  return [...new Set([...after.keys(), ...before.keys()])].flatMap((key) => {
    const old = before.get(key),
      current = after.get(key);
    if (old?.value === current?.value) return [];
    if (!previous && ["Unknown", "No"].includes(current?.value ?? ""))
      return [];
    return [
      {
        key,
        label: (current ?? old)!.label,
        before: old?.value ?? null,
        after: current?.value ?? null,
      },
    ];
  });
}
