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
import { formatCurrency } from "./format";

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
}: {
  reviewed: ReviewedInvestment;
  reportedValueMinor: number | null;
  currentSnapshotId: string;
  currentReportedValueSnapshotId: string;
}) {
  const current = reviewed.snapshotId === currentSnapshotId;
  const money = (n: number | null) =>
    n === null || !current ? "Unknown" : formatCurrency(n, "USD");
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
        cashPaidMinor: reviewed.cashPaidMinor,
        netCapitalMinor: reviewed.netCapitalMinor,
        carryPpm: terms.carryPpm,
        carryBasis: terms.carryBasis,
      })
    : null;
  const unknownAnnual =
    terms.annualManagementFeePpm === null ||
    (terms.annualManagementFeePpm > 0 &&
      terms.annualManagementBasis === "unknown");
  return (
    <div
      className="investment-calculation"
      aria-label="Investment calculation preview"
    >
      <h4>Calculation preview</h4>
      <StatGroup className="investment-capital-totals">
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
      <DataList>
        <DataItem
          label="Annual management fee"
          value={
            terms.annualManagementFeePpm === null
              ? "Unknown"
              : `${rateText(terms.annualManagementFeePpm)}% · ${terms.annualManagementBasis === "unknown" ? "basis unknown" : terms.annualManagementBasis === "gross_cash" ? "on cash paid" : "on net capital"}`
          }
        />
        <DataItem
          label="Carry on gains"
          value={
            terms.carryPpm === null
              ? "Unknown"
              : `${rateText(terms.carryPpm)}% · ${terms.carryBasis === "unknown" ? "basis unknown" : terms.carryBasis === "gross_cash" ? "above cash paid" : "above net capital"}`
          }
        />
      </DataList>
      {terms.note && <p>Terms source / disagreements: {terms.note}</p>}
      <p>
        Cash paid − upfront deductions = net capital invested. Reported return
        compares the current mark plus reported distributions with cash paid; it
        does not deduct carry again.
      </p>
      {boundValue && (
        <p>
          Reported mark: {formatCurrency(boundValue.valueMinor, "USD")} ·{" "}
          {boundValue.sourceLabel} ·{" "}
          {boundValue.effectiveDate ?? "Value date unknown"} ·{" "}
          {boundValue.carryStatus.replaceAll("_", " ")}
          {boundValue.carryStatus === "unknown" ? " carry status" : ""}.
        </p>
      )}
      {estimate && (
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
      {estimate && !estimate.alreadyAfterCarry && (
        <p>
          Carry on remaining value above{" "}
          {terms.carryBasis === "gross_cash" ? "cash paid" : "net capital"}.
          Excludes distributions, fees, taxes and exit expenses.
        </p>
      )}
      <Notice>
        {!current
          ? "The source changed. Review these details again."
          : reviewed.cashPaidMinor === null
            ? "Confirm all cash contributions and record cash paid to calculate return."
            : !estimate
              ? "A reliable estimate after carry needs a reported value basis, carry rate and capital basis."
              : unknownAnnual
                ? "Annual management fees are unknown. Reliable net proceeds are unavailable."
                : (terms.annualManagementFeePpm ?? 0) > 0
                  ? "Remaining annual fees and the exit date are not modeled. Reliable net proceeds are unavailable."
                  : "Proceeds remain an illustration; other exit expenses and taxes are not modeled."}
      </Notice>
      {terms.importedAmountBasis === "unknown" && (
        <p>
          Imported amount basis is unknown. No fees are deducted from it
          automatically.
        </p>
      )}
    </div>
  );
}
