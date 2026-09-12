import { type Holding } from "@keel/domain";
import {
  AcceptPositionEconomicsInputSchema,
  calculatePositionEconomics,
  type PositionEconomicsContext,
} from "@keel/domain/position-economics";
import {
  ActionGroup,
  Button,
  Field,
  Input,
  InputGroup,
  Notice,
  Stat,
  StatGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@keel/ui";
import { useId, useState } from "react";
import { acceptPositionEconomics } from "./api";
import {
  currencyFractionDigits,
  formatCompactCurrency,
  formatProbability,
} from "./format";

const capitalBasisChoices = [
  { value: "gross_commitment", label: "Before fees · gross commitment" },
  { value: "net_invested", label: "Already net of fees · invested capital" },
];

function percentageInputValue(valuePpm: number): string {
  const whole = BigInt(valuePpm) / 10_000n;
  const remainder = BigInt(valuePpm) % 10_000n;
  return remainder === 0n
    ? whole.toString()
    : `${whole}.${remainder.toString().padStart(4, "0").replace(/0+$/u, "")}`;
}

function parsePercentageInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,4})?$/u.test(normalized)) {
    return null;
  }
  const [whole = "0", decimal = ""] = normalized.split(".");
  const ppm = BigInt(whole) * 10_000n + BigInt(decimal.padEnd(4, "0"));
  return ppm <= 1_000_000n ? Number(ppm) : null;
}

function percentageInputValueOrBlank(value: number | null): string {
  return value === null ? "" : percentageInputValue(value);
}

function moneyInputValue(
  value: number | null | undefined,
  currency: string,
): string {
  if (value == null) return "";
  const amount = BigInt(value);
  const digits = currencyFractionDigits(currency);
  const unit = 10n ** BigInt(digits);
  return digits === 0
    ? amount.toString()
    : `${amount / unit}.${(amount % unit).toString().padStart(digits, "0")}`;
}

function parseMoneyInput(value: string, currency: string): number | null {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d*)?$/u.test(normalized)) return null;
  const [whole = "0", decimal = ""] = normalized.split(".");
  const digits = currencyFractionDigits(currency);
  if (decimal.length > digits) return null;
  const minor =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(decimal.padEnd(digits, "0") || "0");
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(minor)
    : null;
}

export function PositionEconomicsEditor({
  holding,
  onAccepted,
}: {
  holding: Pick<Holding, "id" | "sourceLabel" | "positionEconomicsContext">;
  onAccepted: () => Promise<void>;
}) {
  const headingId = useId();
  const context = holding.positionEconomicsContext ?? null;
  const terms = context?.acceptedTerms ?? null;
  const reportedTerms = context?.reportedTerms ?? null;
  const acceptedEconomics =
    context === null ? null : calculatePositionEconomics(context);
  const termsNeedReview = terms !== null && acceptedEconomics === null;
  const reportedManagementFeePpm = reportedTerms?.managementFeePpm ?? null;
  const reportedCarryPpm = reportedTerms?.carryPpm ?? null;
  const hasReportedFee = reportedManagementFeePpm !== null;
  const hasReportedCarryTerm = reportedCarryPpm !== null;
  const reportedFeeDiffers =
    terms !== null &&
    reportedManagementFeePpm !== null &&
    reportedManagementFeePpm !== terms.annualAdminFeePpm;
  const reportedCarryDiffers =
    terms !== null &&
    reportedCarryPpm !== null &&
    reportedCarryPpm !== terms.carryPpm;
  const reportedTermsDiffer = reportedFeeDiffers || reportedCarryDiffers;
  const prefillFromReportedTerms =
    reportedTerms !== null &&
    (terms === null || termsNeedReview || reportedTermsDiffer);
  const initialAnnualFeePpm = prefillFromReportedTerms
    ? (reportedManagementFeePpm ?? terms?.annualAdminFeePpm ?? null)
    : (terms?.annualAdminFeePpm ?? null);
  const initialFeeYears = terms?.adminFeeYears ?? null;
  const initialCarryPpm = prefillFromReportedTerms
    ? (reportedCarryPpm ?? terms?.carryPpm ?? null)
    : (terms?.carryPpm ?? null);
  const reportedFeeLabel =
    reportedManagementFeePpm === null
      ? null
      : formatProbability(reportedManagementFeePpm);
  const reportedCarryLabel =
    reportedCarryPpm === null ? null : formatProbability(reportedCarryPpm);
  const reportedTermsSummary =
    reportedTerms === null
      ? null
      : reportedFeeLabel !== null && reportedCarryLabel !== null
        ? `a ${reportedFeeLabel} management fee and ${reportedCarryLabel} carry`
        : reportedFeeLabel !== null
          ? `a ${reportedFeeLabel} management fee`
          : `${reportedCarryLabel} carry`;
  const reportedTermsInstruction = !hasReportedFee
    ? "Management fee is not included in this source. Confirm it against the deal documents before accepting."
    : !hasReportedCarryTerm
      ? "Carry is not included in this source. Confirm it against the deal documents before accepting."
      : "Confirm the fee term against the deal documents before accepting.";
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [annualFee, setAnnualFee] = useState(
    percentageInputValueOrBlank(initialAnnualFeePpm),
  );
  const [feeYears, setFeeYears] = useState(initialFeeYears?.toString() ?? "");
  const [carry, setCarry] = useState(
    percentageInputValueOrBlank(initialCarryPpm),
  );
  const [capitalBasis, setCapitalBasis] = useState(
    terms === null ? "" : (terms.capitalBasis ?? "gross_commitment"),
  );
  const [grossCommitment, setGrossCommitment] = useState(
    moneyInputValue(terms?.grossCommitmentMinor, context?.currency ?? "USD"),
  );
  const [setupFee, setSetupFee] = useState(
    percentageInputValueOrBlank(terms?.setupFeePpm ?? null),
  );
  const [note, setNote] = useState(terms?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (context === null) {
    return null;
  }

  const money = (minor: number) =>
    formatCompactCurrency(minor, context.currency).replace(/^USD /u, "$");
  const annualAdminFeePpm = parsePercentageInput(annualFee);
  const setupFeePpm = parsePercentageInput(setupFee);
  const adminFeeYears = /^\d+$/u.test(feeYears.trim())
    ? Number(feeYears)
    : null;
  const carryPpm = parsePercentageInput(carry);
  const parsedInput = AcceptPositionEconomicsInputSchema.safeParse({
    expectedSnapshotId: context.snapshotId,
    expectedTermsId: terms?.id ?? null,
    capitalBasis,
    grossCommitmentMinor:
      capitalBasis === "net_invested"
        ? parseMoneyInput(grossCommitment, context.currency)
        : null,
    setupFeePpm,
    annualAdminFeePpm,
    adminFeeYears,
    carryPpm,
    note: note.trim(),
  });
  const validYears =
    adminFeeYears !== null &&
    Number.isSafeInteger(adminFeeYears) &&
    adminFeeYears >= 1 &&
    adminFeeYears <= 100;
  const excessiveFee =
    annualAdminFeePpm !== null &&
    setupFeePpm !== null &&
    validYears &&
    BigInt(annualAdminFeePpm) * BigInt(adminFeeYears) + BigInt(setupFeePpm) >
      1_000_000n;
  const draftContext: PositionEconomicsContext | null = parsedInput.success
    ? {
        ...context,
        acceptedTerms: {
          ...parsedInput.data,
          id: terms?.id ?? "draft-position-economics",
          positionId: holding.id,
          acceptedAgainstSnapshotId: context.snapshotId,
          commitmentMinorAtAcceptance: context.committedMinor,
          fundedMinorAtAcceptance: context.fundedMinor,
          acceptedAt: terms?.acceptedAt ?? new Date().toISOString(),
        },
      }
    : null;
  const draftEconomics =
    draftContext === null ? null : calculatePositionEconomics(draftContext);
  const capitalMismatch = parsedInput.success && draftEconomics === null;
  const changed =
    terms === null ||
    termsNeedReview ||
    capitalBasis !== (terms.capitalBasis ?? "gross_commitment") ||
    (capitalBasis === "net_invested"
      ? parseMoneyInput(grossCommitment, context.currency)
      : null) !== (terms.grossCommitmentMinor ?? null) ||
    setupFeePpm !== (terms.setupFeePpm ?? null) ||
    annualAdminFeePpm !== terms.annualAdminFeePpm ||
    adminFeeYears !== terms.adminFeeYears ||
    carryPpm !== terms.carryPpm ||
    note.trim() !== terms.note;
  const canReview = draftEconomics !== null && changed;
  const reset = () => {
    setOpen(false);
    setReviewing(false);
    setAnnualFee(percentageInputValueOrBlank(initialAnnualFeePpm));
    setFeeYears(initialFeeYears?.toString() ?? "");
    setCarry(percentageInputValueOrBlank(initialCarryPpm));
    setCapitalBasis(
      terms === null ? "" : (terms.capitalBasis ?? "gross_commitment"),
    );
    setGrossCommitment(
      moneyInputValue(terms?.grossCommitmentMinor, context?.currency ?? "USD"),
    );
    setSetupFee(percentageInputValueOrBlank(terms?.setupFeePpm ?? null));
    setNote(terms?.note ?? "");
    setError(null);
  };

  const accept = async () => {
    if (!canReview || !parsedInput.success) return;
    setBusy(true);
    setError(null);
    try {
      await acceptPositionEconomics(holding.id, parsedInput.data);
      await onAccepted();
      reset();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The SPV terms could not be accepted.",
      );
    } finally {
      setBusy(false);
    }
  };

  const displayedEconomics = acceptedEconomics;
  return (
    <section aria-labelledby={headingId} className="position-economics">
      <div className="position-economics__heading">
        <div>
          <p className="eyebrow">Investment terms</p>
          <h3 id={headingId}>SPV economics</h3>
          <p>Review how fees relate to the imported investment amount.</p>
        </div>
        {!open && (
          <Button
            onClick={() => {
              reset();
              setOpen(true);
            }}
            tone="secondary"
          >
            {terms === null
              ? reportedTerms === null
                ? "Add fee & carry"
                : "Review fee & carry"
              : termsNeedReview || reportedTermsDiffer
                ? "Review fee & carry"
                : "Update fee & carry"}
          </Button>
        )}
      </div>

      <StatGroup className="position-economics__values">
        <Stat
          detail={
            displayedEconomics !== null &&
            terms?.capitalBasis === "net_invested"
              ? `Imported net: ${money(context.committedMinor)} from ${holding.sourceLabel}.`
              : `Accepted from ${holding.sourceLabel}.`
          }
          label={
            displayedEconomics === null
              ? "Imported amount"
              : terms?.capitalBasis === "net_invested"
                ? "Gross commitment"
                : "Commitment"
          }
          value={money(
            displayedEconomics?.committedMinor ?? context.committedMinor,
          )}
        />
        <Stat
          detail={
            terms?.capitalBasis === "net_invested" &&
            displayedEconomics !== null
              ? "Reported after fees."
              : "Amount reported by the source."
          }
          label={
            terms?.capitalBasis === "net_invested" &&
            displayedEconomics !== null
              ? "Imported funded capital"
              : "Funded capital"
          }
          value={money(context.fundedMinor)}
        />
        <Stat
          detail={
            reportedFeeDiffers && reportedTerms !== null
              ? `${reportedTerms.sourceLabel} now reports ${reportedFeeLabel}; accepted terms remain in use until review.`
              : hasReportedFee &&
                  reportedTerms !== null &&
                  (terms === null || termsNeedReview)
                ? `${reportedTerms.sourceLabel} reports ${reportedFeeLabel}; confirm the fee term.`
                : terms === null
                  ? reportedTerms !== null
                    ? "Management fee is not included in this source."
                    : "Add the fee rate and term."
                  : termsNeedReview
                    ? "Commitment or funded capital changed after acceptance."
                    : `Management: ${money(displayedEconomics!.upfrontAdminFeeMinor)}. Setup: ${terms.setupFeePpm == null ? "not recorded" : money(displayedEconomics!.setupFeeMinor)}.`
          }
          label="Upfront fees"
          value={
            displayedEconomics === null
              ? termsNeedReview
                ? "Needs review"
                : reportedManagementFeePpm === null
                  ? "Not set"
                  : "Not accepted"
              : money(
                  Number(
                    BigInt(displayedEconomics.upfrontAdminFeeMinor) +
                      BigInt(displayedEconomics.setupFeeMinor),
                  ),
                )
          }
          valueClassName={displayedEconomics === null ? "is-not-set" : ""}
        />
        <Stat
          detail="Gross commitment less fees. Not tax basis."
          label="Net invested"
          value={
            displayedEconomics === null
              ? termsNeedReview
                ? "Needs review"
                : "Not set"
              : money(displayedEconomics.positionCostBasisMinor)
          }
          valueClassName={displayedEconomics === null ? "is-not-set" : ""}
        />
        <Stat
          detail={
            reportedCarryDiffers && reportedTerms !== null
              ? `${reportedTerms.sourceLabel} now reports ${reportedCarryLabel}; accepted carry remains in use.`
              : hasReportedCarryTerm &&
                  reportedTerms !== null &&
                  (terms === null || termsNeedReview)
                ? `Reported by ${reportedTerms.sourceLabel}; accept before use.`
                : terms === null && reportedTerms !== null
                  ? "Carry is not included in this source."
                  : termsNeedReview
                    ? "Review against the current source before applying carry."
                    : "Applied to gains when an exit is recorded."
          }
          label="Carry"
          value={
            terms === null
              ? reportedCarryPpm === null
                ? "Not set"
                : formatProbability(reportedCarryPpm)
              : termsNeedReview
                ? reportedCarryPpm === null
                  ? "Needs review"
                  : formatProbability(reportedCarryPpm)
                : formatProbability(terms.carryPpm)
          }
          valueClassName={terms === null || termsNeedReview ? "is-not-set" : ""}
        />
      </StatGroup>

      {open && !reviewing && (
        <form
          noValidate
          className="position-economics__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canReview) {
              setReviewing(true);
              setError(null);
            }
          }}
        >
          {prefillFromReportedTerms && reportedTerms !== null && (
            <p className="position-economics__reported">
              {`${reportedTerms.sourceLabel} reports ${reportedTermsSummary}. ${reportedTermsInstruction}`}
            </p>
          )}
          <div className="position-economics__fields">
            <Field label="Imported amount" variant="filled" wide>
              <Select
                items={capitalBasisChoices}
                onValueChange={(value) => {
                  if (typeof value === "string") setCapitalBasis(value);
                }}
                value={capitalBasis || null}
                required
              >
                <SelectTrigger aria-label="Imported amount">
                  <SelectValue placeholder="Choose how the amount is reported" />
                </SelectTrigger>
                <SelectContent>
                  {capitalBasisChoices.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {capitalBasis === "net_invested" && (
              <Field
                label={`Gross commitment · ${context.currency}`}
                description={`Before fees. The imported net amount is ${money(context.committedMinor)}.`}
                variant="filled"
                wide
              >
                <Input
                  inputMode="decimal"
                  aria-label={`Gross commitment · ${context.currency}`}
                  value={grossCommitment}
                  onChange={(event) =>
                    setGrossCommitment(event.currentTarget.value)
                  }
                  required
                />
              </Field>
            )}
            <Field label="Management fee rate" variant="filled">
              <InputGroup suffix="%">
                <Input
                  aria-label="Management fee rate"
                  inputMode="decimal"
                  onChange={(event) => setAnnualFee(event.currentTarget.value)}
                  required
                  value={annualFee}
                />
              </InputGroup>
            </Field>
            <Field
              label="Fee term"
              description="Use 1 year for a one-time fee."
              variant="filled"
            >
              <InputGroup suffix="years">
                <Input
                  aria-label="Fee term"
                  inputMode="numeric"
                  max="100"
                  min="1"
                  onChange={(event) => setFeeYears(event.currentTarget.value)}
                  required
                  value={feeYears}
                />
              </InputGroup>
            </Field>
            <Field label="Setup fee" variant="filled">
              <InputGroup suffix="%">
                <Input
                  aria-label="Setup fee"
                  inputMode="decimal"
                  value={setupFee}
                  onChange={(event) => setSetupFee(event.currentTarget.value)}
                  required
                />
              </InputGroup>
            </Field>
            <Field label="Carry" variant="filled">
              <InputGroup suffix="%">
                <Input
                  aria-label="Carry"
                  inputMode="decimal"
                  onChange={(event) => setCarry(event.currentTarget.value)}
                  required
                  value={carry}
                />
              </InputGroup>
            </Field>
            <Field label="What changed" variant="filled" wide>
              <Input
                maxLength={500}
                onChange={(event) => setNote(event.currentTarget.value)}
                placeholder="Reviewed SPV subscription terms"
                required
                value={note}
              />
            </Field>
          </div>
          {excessiveFee && (
            <Notice tone="error">
              Management and setup fees together cannot exceed 100%.
            </Notice>
          )}
          {capitalMismatch && (
            <Notice tone="error">
              Gross commitment less management and setup fees must equal the
              imported net amount of {money(context.committedMinor)}.
            </Notice>
          )}
          {error !== null && <Notice tone="error">{error}</Notice>}
          <ActionGroup
            align="end"
            className="position-economics__actions"
            mobileLayout="grid"
          >
            <Button disabled={busy} onClick={reset} tone="quiet" type="button">
              Cancel
            </Button>
            <Button disabled={!canReview || busy} tone="primary" type="submit">
              Review terms
            </Button>
          </ActionGroup>
        </form>
      )}

      {open && reviewing && draftEconomics !== null && (
        <div className="position-economics__review">
          <div>
            <span>Gross commitment</span>
            <strong>{money(draftEconomics.committedMinor)}</strong>
          </div>
          <div>
            <span>Upfront management fee</span>
            <strong>
              {formatProbability(draftEconomics.totalAdminFeePpm)} ·{" "}
              {money(draftEconomics.upfrontAdminFeeMinor)}
            </strong>
          </div>
          <div>
            <span>Setup fee</span>
            <strong>
              {formatProbability(draftEconomics.setupFeePpm)} ·{" "}
              {money(draftEconomics.setupFeeMinor)}
            </strong>
          </div>
          <div>
            <span>Net invested</span>
            <strong>{money(draftEconomics.positionCostBasisMinor)}</strong>
          </div>
          <div>
            <span>Carry on exit gains</span>
            <strong>{formatProbability(draftEconomics.carryPpm)}</strong>
          </div>
          {capitalBasis === "net_invested" && (
            <p>Fees have already been deducted from the imported amount.</p>
          )}
          <p>{note.trim()}</p>
          <small>
            Carry is recorded as a term now and applied only when a partial or
            full exit is accepted.
          </small>
          {error !== null && <Notice tone="error">{error}</Notice>}
          <ActionGroup
            align="end"
            className="position-economics__actions"
            mobileLayout="grid"
          >
            <Button
              disabled={busy}
              onClick={() => setReviewing(false)}
              tone="quiet"
            >
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={() => void accept()}
              tone="primary"
            >
              {busy ? "Accepting…" : "Accept terms"}
            </Button>
          </ActionGroup>
        </div>
      )}
    </section>
  );
}
