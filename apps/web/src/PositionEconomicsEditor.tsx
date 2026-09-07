import { type Holding } from "@keel/domain";
import {
  calculatePositionEconomics,
  type PositionEconomicsContext,
} from "@keel/domain/position-economics";
import {
  ActionGroup,
  Button,
  Field,
  FormMessage,
  Input,
  InputGroup,
  Notice,
  Stat,
  StatGroup,
} from "@keel/ui";
import { useId, useState } from "react";
import { acceptPositionEconomics } from "./api";
import { formatCompactMoney, formatProbability } from "./format";

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
    : (terms?.annualAdminFeePpm ?? 10_000);
  const initialFeeYears = prefillFromReportedTerms
    ? (terms?.adminFeeYears ?? null)
    : (terms?.adminFeeYears ?? 10);
  const initialCarryPpm = prefillFromReportedTerms
    ? (reportedCarryPpm ?? terms?.carryPpm ?? null)
    : (terms?.carryPpm ?? 200_000);
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
  const [note, setNote] = useState(terms?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (context === null) {
    return null;
  }

  const annualAdminFeePpm = parsePercentageInput(annualFee);
  const adminFeeYears = /^\d+$/u.test(feeYears.trim())
    ? Number(feeYears)
    : null;
  const carryPpm = parsePercentageInput(carry);
  const validYears =
    adminFeeYears !== null &&
    Number.isSafeInteger(adminFeeYears) &&
    adminFeeYears >= 1 &&
    adminFeeYears <= 100;
  const validTotalFee =
    annualAdminFeePpm !== null &&
    validYears &&
    BigInt(annualAdminFeePpm) * BigInt(adminFeeYears) <= 1_000_000n;
  const canReview =
    validTotalFee && carryPpm !== null && note.trim().length >= 3;
  const draftContext: PositionEconomicsContext | null = canReview
    ? {
        ...context,
        acceptedTerms: {
          id: terms?.id ?? "draft-position-economics",
          positionId: holding.id,
          acceptedAgainstSnapshotId: context.snapshotId,
          commitmentMinorAtAcceptance: context.committedMinor,
          fundedMinorAtAcceptance: context.fundedMinor,
          annualAdminFeePpm,
          adminFeeYears,
          carryPpm,
          note: note.trim(),
          acceptedAt: terms?.acceptedAt ?? new Date().toISOString(),
        },
      }
    : null;
  const draftEconomics =
    draftContext === null ? null : calculatePositionEconomics(draftContext);
  const reset = () => {
    setOpen(false);
    setReviewing(false);
    setAnnualFee(percentageInputValueOrBlank(initialAnnualFeePpm));
    setFeeYears(initialFeeYears?.toString() ?? "");
    setCarry(percentageInputValueOrBlank(initialCarryPpm));
    setNote(terms?.note ?? "");
    setError(null);
  };

  const accept = async () => {
    if (
      !canReview ||
      annualAdminFeePpm === null ||
      adminFeeYears === null ||
      carryPpm === null
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptPositionEconomics(holding.id, {
        expectedSnapshotId: context.snapshotId,
        expectedTermsId: terms?.id ?? null,
        annualAdminFeePpm,
        adminFeeYears,
        carryPpm,
        note: note.trim(),
      });
      await onAccepted();
      reset();
      setNotice("SPV fee and carry terms accepted.");
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
          <p>Commitment and funded capital come from the reviewed source.</p>
        </div>
        {!open && (
          <Button
            onClick={() => {
              setOpen(true);
              setNotice(null);
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
          detail={`Accepted from ${holding.sourceLabel}.`}
          label="Commitment"
          value={formatCompactMoney(context.committedMinor)}
        />
        <Stat
          detail="Capital paid into the SPV so far."
          label="Funded capital"
          value={formatCompactMoney(context.fundedMinor)}
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
                    : `${formatProbability(terms.annualAdminFeePpm)} for ${terms.adminFeeYears} years, paid upfront.`
          }
          label="Upfront admin fee"
          value={
            displayedEconomics === null
              ? termsNeedReview
                ? "Needs review"
                : reportedManagementFeePpm === null
                  ? "Not set"
                  : "Not accepted"
              : formatCompactMoney(displayedEconomics.upfrontAdminFeeMinor)
          }
          valueClassName={displayedEconomics === null ? "is-not-set" : ""}
        />
        <Stat
          detail="Commitment less upfront admin fee. Not tax basis."
          label="Position cost basis"
          value={
            displayedEconomics === null
              ? termsNeedReview
                ? "Needs review"
                : "Not set"
              : formatCompactMoney(displayedEconomics.positionCostBasisMinor)
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

      {notice !== null && <FormMessage tone="success">{notice}</FormMessage>}
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
            <Field label="Admin fee rate">
              <InputGroup suffix="%">
                <Input
                  inputMode="decimal"
                  onChange={(event) => setAnnualFee(event.currentTarget.value)}
                  required
                  value={annualFee}
                />
              </InputGroup>
            </Field>
            <Field label="Fee term">
              <InputGroup suffix="years">
                <Input
                  inputMode="numeric"
                  max="100"
                  min="1"
                  onChange={(event) => setFeeYears(event.currentTarget.value)}
                  required
                  value={feeYears}
                />
              </InputGroup>
            </Field>
            <Field label="Carry">
              <InputGroup suffix="%">
                <Input
                  inputMode="decimal"
                  onChange={(event) => setCarry(event.currentTarget.value)}
                  required
                  value={carry}
                />
              </InputGroup>
            </Field>
            <Field label="What changed" wide>
              <Input
                maxLength={500}
                onChange={(event) => setNote(event.currentTarget.value)}
                placeholder="Reviewed SPV subscription terms"
                required
                value={note}
              />
            </Field>
          </div>
          {!validTotalFee && annualAdminFeePpm !== null && validYears && (
            <Notice tone="error">
              The total upfront fee cannot exceed 100%.
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
            <span>Upfront admin fee</span>
            <strong>
              {formatProbability(draftEconomics.totalAdminFeePpm)} ·{" "}
              {formatCompactMoney(draftEconomics.upfrontAdminFeeMinor)}
            </strong>
          </div>
          <div>
            <span>Position cost basis</span>
            <strong>
              {formatCompactMoney(context.committedMinor)} →{" "}
              {formatCompactMoney(draftEconomics.positionCostBasisMinor)}
            </strong>
          </div>
          <div>
            <span>Carry on exit gains</span>
            <strong>{formatProbability(draftEconomics.carryPpm)}</strong>
          </div>
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
