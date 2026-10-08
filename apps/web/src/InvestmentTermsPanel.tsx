import {
  DataItem,
  DataList,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  DatePicker,
  Notice,
  Stat,
  StatGroup,
} from "@keel/ui";
import {
  estimateProceedsAfterCarry,
  type ReviewedInvestment,
} from "@keel/domain/investment-details";
import type { TermsDraft } from "./investment-terms-draft";
import { rateText } from "./investment-terms-draft";
import {
  formatPositionCurrency as formatCurrency,
  formatCompactPositionCurrency,
} from "./format";
import {
  estimatePurchaseCapital,
  type PurchaseLot,
} from "@keel/domain/position-purchases";
import {
  capitalSummaryLabel,
  type CapitalSummary,
} from "./position-capital-summary";

export function PurchaseCapitalPreview({ lot }: { lot: PurchaseLot }) {
  const estimate = estimatePurchaseCapital(lot);
  const refund = lot.capitalReturn;
  if (!estimate && !refund) return null;
  return (
    <div
      className="investment-calculation"
      aria-label="Purchase capital calculation"
    >
      {refund && (
        <p>
          Capital refund: {formatCurrency(refund.amountMinor, "USD")} ·{" "}
          {refund.status === "received" ? "Received" : "Expected"}
          {refund.effectiveDate
            ? ` · ${refund.effectiveDate}`
            : refund.status === "received"
              ? " · Date unknown"
              : ""}
          .
          {lot.grossCashMinor !== null && (
            <>
              {" "}
              {refund.status === "received"
                ? "Cash retained"
                : "Cash after expected refund"}
              :{" "}
              {formatCurrency(
                Number(BigInt(lot.grossCashMinor) - BigInt(refund.amountMinor)),
                "USD",
              )}{" "}
              before upfront fees.
            </>
          )}
        </p>
      )}
      {estimate && (
        <>
          <h4>Estimated capital from upfront fee</h4>
          <StatGroup className="investment-capital-totals">
            <Stat
              label={
                estimate.expectedRefund
                  ? "Cash after expected refund"
                  : "Cash before upfront fee"
              }
              value={formatCurrency(estimate.retainedCashMinor, "USD")}
            />
            <Stat
              label="Estimated upfront fee"
              value={formatCurrency(estimate.upfrontDeductionsMinor, "USD")}
            />
            <Stat
              label="Estimated net capital"
              value={formatCurrency(estimate.netCapitalMinor, "USD")}
            />
          </StatGroup>
          <p>
            Uses the one-time fee rate and its selected basis
            {refund ? " after the capital refund" : ""}. Enter final allocation
            amounts above when known; this estimate does not establish
            underlying shares.
          </p>
        </>
      )}
    </div>
  );
}

const capitalChoices = [
  { value: "unknown", label: "Unknown" },
  { value: "gross_cash", label: "Cash paid" },
  { value: "net_capital", label: "Net capital invested" },
];
export function InvestmentTermsFields({
  draft,
  update,
  importedMinor,
  reportedValueMinor,
  reportedSource,
}: {
  draft: TermsDraft;
  update: (key: string, value: string) => void;
  importedMinor: number | null;
  reportedValueMinor: number | null;
  reportedSource: string;
}) {
  const select = (key: string, label: string, choices = capitalChoices) => (
    <Field label={label} variant="filled">
      <Select
        items={choices}
        value={draft[key] ?? "unknown"}
        onValueChange={(v) => update(key, String(v))}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
  const field = (key: string, label: string) => (
    <Field label={label} variant="filled">
      <Input
        aria-label={label}
        inputMode="decimal"
        value={draft[key] ?? ""}
        onChange={(e) => update(key, e.currentTarget.value)}
      />
    </Field>
  );
  return (
    <div className="investment-terms">
      <h4>Reviewed economic terms</h4>
      <p>
        These terms apply to all recorded purchases. Leave unknown rates blank;
        zero means no fee.
      </p>
      <div className="position-economics__fields">
        {select("importedAmountBasis", "Imported amount represents")}
        {importedMinor !== null && (
          <p>
            Imported amount: {formatCurrency(importedMinor, "USD")}. Your cash
            paid is recorded per purchase above.
          </p>
        )}
        {field("annualManagementFeePpm", "Annual management fee · %")}
        {select("annualManagementBasis", "Annual management fee basis")}
        {field("carryPpm", "Carry on gains · %")}
        {select("carryBasis", "Carry gains above")}
      </div>
      <p>
        Annual fees are recurring expenses. They are not multiplied by a term or
        deducted again from the upfront totals. Carry applies only to positive
        gains above the chosen basis.
      </p>
      <h4>Provider-reported current value</h4>
      <p>
        {reportedValueMinor === null
          ? "No reported value available."
          : `${formatCurrency(reportedValueMinor, "USD")} · ${reportedSource}`}
      </p>
      {reportedValueMinor !== null && (
        <div className="position-economics__fields">
          {select("carryStatus", "Reported value carry status", [
            { value: "unknown", label: "Unknown" },
            { value: "before_carry", label: "Before carry" },
            { value: "after_carry", label: "After carry" },
          ])}
          <Field label="Value as of (if known)" variant="filled">
            <DatePicker
              aria-label="Value as of (if known)"
              value={draft.valueDate ?? ""}
              onValueChange={(value) => update("valueDate", value)}
            />
          </Field>
        </div>
      )}
      <Field label="Terms source / disagreements (optional)" variant="filled">
        <Textarea
          aria-label="Terms source / disagreements (optional)"
          value={draft.note ?? ""}
          onChange={(e) => update("note", e.currentTarget.value)}
        />
      </Field>
    </div>
  );
}

export function InvestmentCalculationPreview({
  reviewed,
  reportedValueMinor,
  currentSnapshotId,
  currentReportedValueSnapshotId,
  view = "full",
  compact = true,
  capitalSummary,
}: {
  reviewed: ReviewedInvestment;
  reportedValueMinor: number | null;
  currentSnapshotId: string;
  currentReportedValueSnapshotId: string;
  view?: "full" | "cash" | "terms";
  compact?: boolean;
  capitalSummary?: CapitalSummary | null;
}) {
  const current = reviewed.snapshotId === currentSnapshotId;
  const money = (n: number | null) =>
    n === null || !current ? "Unknown" : formatCurrency(n, "USD");
  const summaryMoney = (n: number) =>
    compact
      ? formatCompactPositionCurrency(n, "USD")
      : formatCurrency(n, "USD");
  const terms = reviewed.terms;
  const value = terms.reportedValueReview;
  const boundValue =
    current &&
    value?.valueMinor === reportedValueMinor &&
    value.sourceSnapshotId === currentReportedValueSnapshotId
      ? value
      : null;
  const estimate = boundValue
    ? estimateProceedsAfterCarry({
        valueMinor: boundValue.valueMinor,
        carryStatus: boundValue.carryStatus,
        cashPaidMinor:
          reviewed.cashPaidMinor === null
            ? null
            : Number(
                BigInt(reviewed.cashPaidMinor) -
                  BigInt(reviewed.returnedCapitalMinor ?? 0),
              ),
        netCapitalMinor: reviewed.netCapitalMinor,
        carryPpm: terms.carryPpm,
        carryBasis: terms.carryBasis,
      })
    : null;
  const unknownAnnual =
    terms.annualManagementFeePpm === null ||
    (terms.annualManagementFeePpm > 0 &&
      terms.annualManagementBasis === "unknown");
  const cashSummary = capitalSummary ?? {
    amountMinor:
      reviewed.netCapitalMinor ??
      (reviewed.cashPaidMinor === null
        ? null
        : Number(
            BigInt(reviewed.cashPaidMinor) -
              BigInt(reviewed.returnedCapitalMinor ?? 0),
          )),
    upfrontFeesMinor: reviewed.upfrontDeductionsMinor,
    kind:
      reviewed.netCapitalMinor === null
        ? ("before_fees" as const)
        : ("net" as const),
    assumedFeeBasis: false,
  };
  return (
    <div
      className={`investment-calculation${view === "cash" ? " investment-calculation--cash" : ""}`}
      aria-label="Investment calculation preview"
    >
      {view !== "terms" && (
        <>
          {view === "cash" ? (
            <StatGroup className="investment-capital-totals investment-capital-totals--compact">
              {current && cashSummary.amountMinor !== null && (
                <Stat
                  label={capitalSummaryLabel(cashSummary)}
                  value={summaryMoney(cashSummary.amountMinor)}
                />
              )}
              {current && (reviewed.cashPaidMinor ?? 0) > 0 && (
                <Stat
                  label="Cash paid"
                  value={summaryMoney(reviewed.cashPaidMinor!)}
                />
              )}
              {current && (reviewed.returnedCapitalMinor ?? 0) > 0 && (
                <Stat
                  label="Refunded"
                  value={summaryMoney(reviewed.returnedCapitalMinor!)}
                />
              )}
              {current && (cashSummary.upfrontFeesMinor ?? 0) > 0 && (
                <Stat
                  label={
                    cashSummary.kind === "estimated_net"
                      ? "Estimated upfront fees"
                      : "Upfront fees"
                  }
                  value={summaryMoney(cashSummary.upfrontFeesMinor!)}
                />
              )}
            </StatGroup>
          ) : (
            <>
              <h4>Calculation preview</h4>
              <StatGroup className="investment-capital-totals">
                {(reviewed.returnedCapitalMinor ?? 0) > 0 && (
                  <Stat
                    label="Cash after refunds"
                    value={money(
                      reviewed.cashPaidMinor == null
                        ? null
                        : Number(
                            BigInt(reviewed.cashPaidMinor) -
                              BigInt(reviewed.returnedCapitalMinor ?? 0),
                          ),
                    )}
                    detail="Before upfront fees"
                  />
                )}
                <Stat label="Cash paid" value={money(reviewed.cashPaidMinor)} />
                <Stat
                  label="Upfront deductions"
                  value={money(reviewed.upfrontDeductionsMinor)}
                />
                <Stat
                  label="Net capital invested"
                  value={money(reviewed.netCapitalMinor)}
                />
              </StatGroup>
            </>
          )}
          {view !== "cash" && (reviewed.returnedCapitalMinor ?? 0) > 0 && (
            <p>
              Received capital refunds: {money(reviewed.returnedCapitalMinor!)}.
              Original cash paid stays in your history. Net capital subtracts
              received refunds and upfront deductions.
              {reviewed.netCapitalMinor === null &&
                " Confirm upfront deductions or the final allocation to calculate net capital invested."}
            </p>
          )}
        </>
      )}
      {view !== "cash" && (
        <>
          <DataList>
            {(terms.annualManagementFeePpm ?? 0) > 0 && (
              <DataItem
                label="Annual management fee"
                value={`${rateText(terms.annualManagementFeePpm)}%${terms.annualManagementBasis === "gross_cash" ? " on cash paid" : terms.annualManagementBasis === "net_capital" ? " on net capital" : ""}`}
              />
            )}
            {(terms.carryPpm ?? 0) > 0 && (
              <DataItem
                label="Carry on gains"
                value={`${rateText(terms.carryPpm)}%${terms.carryBasis === "gross_cash" ? " above cash paid" : terms.carryBasis === "net_capital" ? " above net capital" : ""}`}
              />
            )}
          </DataList>
          {terms.note && <p>Terms source / disagreements: {terms.note}</p>}
          {view === "full" && (
            <p>
              Cash paid
              {(reviewed.returnedCapitalMinor ?? 0) > 0
                ? " − received capital refunds"
                : ""}{" "}
              − upfront deductions = net capital invested. Reported return
              compares the current mark plus reported distributions with cash
              paid; it does not deduct carry again.
            </p>
          )}
          {view === "full" && boundValue && (
            <p>
              Reported mark: {formatCurrency(boundValue.valueMinor, "USD")} ·{" "}
              {boundValue.sourceLabel} ·{" "}
              {boundValue.effectiveDate ?? "Value date unknown"} ·{" "}
              {boundValue.carryStatus.replaceAll("_", " ")}
              {boundValue.carryStatus === "unknown" ? " carry status" : ""}.
            </p>
          )}
          {view === "full" && estimate && (
            <DataList>
              <DataItem
                label={
                  estimate.alreadyAfterCarry
                    ? "Reported value · after carry"
                    : "Illustrative proceeds after carry"
                }
                value={formatCurrency(estimate.proceedsMinor, "USD")}
              />
              {estimate.carryMinor !== null && (
                <DataItem
                  label="Estimated carry on unrealized gains"
                  value={formatCurrency(estimate.carryMinor, "USD")}
                />
              )}
            </DataList>
          )}
          {view === "full" && estimate && !estimate.alreadyAfterCarry && (
            <p>
              Carry on remaining value above{" "}
              {terms.carryBasis === "gross_cash" ? "cash paid" : "net capital"}.
              Excludes distributions, fees, taxes and exit expenses.
            </p>
          )}
        </>
      )}
      {view !== "terms" &&
        (view !== "cash" ||
          (!compact && reviewed.returnedCapitalReconciliationPending) ||
          !current ||
          reviewed.cashPaidMinor === null) && (
          <Notice>
            {!current
              ? "The source changed. Review these details again."
              : reviewed.cashPaidMinor === null
                ? "Confirm all cash contributions and record cash paid to calculate return."
                : reviewed.returnedCapitalReconciliationPending
                  ? "Return stays unknown until you confirm whether the reported distributions include this refund."
                  : !estimate
                    ? "A reliable estimate after carry needs a reported value basis, carry rate and capital basis."
                    : unknownAnnual
                      ? "Annual management fees are unknown. Reliable net proceeds are unavailable."
                      : (terms.annualManagementFeePpm ?? 0) > 0
                        ? "Remaining annual fees and the exit date are not modeled. Reliable net proceeds are unavailable."
                        : "Proceeds remain an illustration; other exit expenses and taxes are not modeled."}
          </Notice>
        )}
      {view === "full" && terms.importedAmountBasis === "unknown" && (
        <p>
          Imported amount basis is unknown. No fees are deducted from it
          automatically.
        </p>
      )}
    </div>
  );
}
