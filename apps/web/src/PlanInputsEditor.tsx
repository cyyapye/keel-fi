import {
  createPlanInputImpact,
  type PlanInputSave,
  type PlanInputState,
} from "@keel/domain";
import { Badge, Button, Panel } from "@keel/ui";
import { useEffect, useMemo, useState } from "react";

import { loadPlanInputs, savePlanInputs } from "./api";
import { formatCompactMoney, formatDate } from "./format";

type PlanInputDraft = {
  householdBurnMonthly: string;
  businessBurnMonthly: string;
  protectedCashFloor: string;
};

function moneyInputValue(minorUnits: number): string {
  const amount = BigInt(minorUnits);
  const dollars = amount / 100n;
  const cents = amount % 100n;
  return cents === 0n
    ? dollars.toLocaleString("en-US")
    : `${dollars.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

function parseMoneyInput(value: string): number | null {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
    return null;
  }
  const [whole = "0", decimal = ""] = normalized.split(".");
  const minor = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function draftFromPlan(plan: PlanInputState): PlanInputDraft {
  return {
    householdBurnMonthly: moneyInputValue(
      plan.values.householdBurnMonthlyMinor,
    ),
    businessBurnMonthly: moneyInputValue(plan.values.businessBurnMonthlyMinor),
    protectedCashFloor: moneyInputValue(plan.values.protectedCashFloorMinor),
  };
}

function runwayLabel(months: number, totalMonthlyBurnMinor: number): string {
  return totalMonthlyBurnMinor === 0 ? "No monthly burn" : `${months} months`;
}

export function PlanInputsEditor({
  onSaved,
}: {
  onSaved: () => Promise<void>;
}) {
  const [plan, setPlan] = useState<PlanInputState | null>(null);
  const [draft, setDraft] = useState<PlanInputDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadPlanInputs(controller.signal)
      .then((nextPlan) => {
        setPlan(nextPlan);
        setDraft(draftFromPlan(nextPlan));
        setChangeNote(null);
        setSaveState("idle");
        setSaveMessage(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "The runway plan could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [reloadKey]);

  const parsedValues = useMemo(() => {
    if (draft === null) {
      return null;
    }
    const householdBurnMonthlyMinor = parseMoneyInput(
      draft.householdBurnMonthly,
    );
    const businessBurnMonthlyMinor = parseMoneyInput(draft.businessBurnMonthly);
    const protectedCashFloorMinor = parseMoneyInput(draft.protectedCashFloor);
    return householdBurnMonthlyMinor === null ||
      businessBurnMonthlyMinor === null ||
      protectedCashFloorMinor === null
      ? null
      : {
          householdBurnMonthlyMinor,
          businessBurnMonthlyMinor,
          protectedCashFloorMinor,
        };
  }, [draft]);
  const impact = useMemo(() => {
    if (plan === null || parsedValues === null) {
      return null;
    }
    try {
      return createPlanInputImpact(parsedValues, plan.fiEligibleLiquidMinor);
    } catch {
      return null;
    }
  }, [parsedValues, plan]);
  const hasDraftChanges =
    plan !== null &&
    parsedValues !== null &&
    (parsedValues.householdBurnMonthlyMinor !==
      plan.values.householdBurnMonthlyMinor ||
      parsedValues.businessBurnMonthlyMinor !==
        plan.values.businessBurnMonthlyMinor ||
      parsedValues.protectedCashFloorMinor !==
        plan.values.protectedCashFloorMinor);
  const changedLabels =
    plan === null || parsedValues === null
      ? []
      : [
          {
            label: "Household burn",
            prior: plan.values.householdBurnMonthlyMinor,
            next: parsedValues.householdBurnMonthlyMinor,
          },
          {
            label: "Business burn",
            prior: plan.values.businessBurnMonthlyMinor,
            next: parsedValues.businessBurnMonthlyMinor,
          },
          {
            label: "Protected cash floor",
            prior: plan.values.protectedCashFloorMinor,
            next: parsedValues.protectedCashFloorMinor,
          },
        ].filter(({ prior, next }) => prior !== next);
  const automaticChangeNote = (
    changedLabels.length === 0
      ? "Runway plan update"
      : changedLabels
          .map(
            ({ label, prior, next }) =>
              `${label}: $${moneyInputValue(prior)} → $${moneyInputValue(next)}`,
          )
          .join("; ")
  ).slice(0, 500);
  const effectiveChangeNote = (changeNote ?? automaticChangeNote).trim();

  const updateDraft = (key: keyof PlanInputDraft, value: string) => {
    setDraft((current) =>
      current === null ? current : { ...current, [key]: value },
    );
    setSaveState("idle");
    setSaveMessage(null);
  };

  const reloadLatest = () => {
    setLoadError(null);
    setPlan(null);
    setDraft(null);
    setReloadKey((current) => current + 1);
  };

  const resetDraft = () => {
    if (plan === null) {
      return;
    }
    setDraft(draftFromPlan(plan));
    setChangeNote(null);
    setSaveState("idle");
    setSaveMessage(null);
  };

  const submit = () => {
    if (
      plan === null ||
      parsedValues === null ||
      impact === null ||
      !hasDraftChanges ||
      effectiveChangeNote.length === 0
    ) {
      setSaveState("error");
      setSaveMessage("Check the plan values and change note before saving.");
      return;
    }
    const input: PlanInputSave = {
      baseCashFlowPlanId: plan.baseCashFlowPlanId,
      baseForecastSnapshotId: plan.baseForecastSnapshotId,
      baseForecastSnapshotVersion: plan.baseForecastSnapshotVersion,
      ...parsedValues,
      changeNote: effectiveChangeNote,
    };
    setSaveState("saving");
    setSaveMessage(null);
    void savePlanInputs(input)
      .then(async (result) => {
        setPlan(result.plan);
        setDraft(draftFromPlan(result.plan));
        setChangeNote(null);
        setSaveState("saved");
        setSaveMessage(
          `Plan saved with forecast version ${result.plan.baseForecastSnapshotVersion}.`,
        );
        try {
          await onSaved();
        } catch {
          setSaveMessage(
            "Plan saved. Refresh the page to update the rest of the forecast.",
          );
        }
      })
      .catch((error: unknown) => {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error
            ? `${error.message} Your draft is still here.`
            : "The runway plan could not be saved. Your draft is still here.",
        );
      });
  };

  if (loadError !== null) {
    return (
      <Panel
        className="plan-inputs plan-inputs--error"
        eyebrow="Runway plan"
        title="Plan inputs are unavailable"
      >
        <p className="inline-error" role="alert">
          {loadError}
        </p>
        <Button onClick={reloadLatest}>Try again</Button>
      </Panel>
    );
  }

  if (plan === null || draft === null) {
    return (
      <Panel className="plan-inputs" eyebrow="Runway plan" title="Plan inputs">
        <p className="plan-inputs__copy">Loading the accepted plan…</p>
      </Panel>
    );
  }

  const runwayChange =
    impact === null
      ? 0
      : impact.protectedRunwayMonths - plan.impact.protectedRunwayMonths;

  return (
    <Panel
      action={
        <Badge
          tone={
            saveState === "error"
              ? "negative"
              : hasDraftChanges
                ? "warning"
                : saveState === "saved"
                  ? "positive"
                  : "neutral"
          }
        >
          {hasDraftChanges
            ? "Unsaved draft"
            : saveState === "saved"
              ? "Plan saved"
              : "Current plan"}
        </Badge>
      }
      className="plan-inputs plan-inputs-editor"
      eyebrow="Runway plan"
      title="Plan inputs"
    >
      <p className="plan-inputs__copy">
        Change monthly burn or the cash floor, review the runway, then save.
        Nothing changes until you save.
      </p>

      <div className="plan-inputs__context" aria-label="Plan-owned values">
        <article>
          <span>FI-eligible liquid</span>
          <strong>{formatCompactMoney(plan.fiEligibleLiquidMinor)}</strong>
          <small>From Holdings</small>
        </article>
        <article>
          <span>FI target</span>
          <strong>{formatCompactMoney(plan.fiTargetMinor)}</strong>
          <small>From Goals</small>
        </article>
        <article>
          <span>Forecast base</span>
          <strong>Version {plan.baseForecastSnapshotVersion}</strong>
          <small>Through {formatDate(plan.forecastHorizonDate)}</small>
        </article>
      </div>

      <form
        className="plan-inputs__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="plan-inputs__fields">
          <label className="field">
            <span>Household burn / month</span>
            <div className="field__value">
              <i>$</i>
              <input
                aria-invalid={
                  parseMoneyInput(draft.householdBurnMonthly) === null
                    ? true
                    : undefined
                }
                inputMode="decimal"
                onChange={(event) =>
                  updateDraft("householdBurnMonthly", event.target.value)
                }
                value={draft.householdBurnMonthly}
              />
            </div>
            <small>Personal operating costs</small>
          </label>
          <label className="field">
            <span>Business burn / month</span>
            <div className="field__value">
              <i>$</i>
              <input
                aria-invalid={
                  parseMoneyInput(draft.businessBurnMonthly) === null
                    ? true
                    : undefined
                }
                inputMode="decimal"
                onChange={(event) =>
                  updateDraft("businessBurnMonthly", event.target.value)
                }
                value={draft.businessBurnMonthly}
              />
            </div>
            <small>Business costs covered by the plan</small>
          </label>
          <label className="field">
            <span>Protected cash floor</span>
            <div className="field__value">
              <i>$</i>
              <input
                aria-invalid={
                  parseMoneyInput(draft.protectedCashFloor) === null
                    ? true
                    : undefined
                }
                inputMode="decimal"
                onChange={(event) =>
                  updateDraft("protectedCashFloor", event.target.value)
                }
                value={draft.protectedCashFloor}
              />
            </div>
            <small>Excluded before runway is calculated</small>
          </label>
        </div>

        <div className="plan-inputs__preview" aria-live="polite">
          <article>
            <span>Protected runway</span>
            <strong>
              {impact === null
                ? "Check values"
                : runwayLabel(
                    impact.protectedRunwayMonths,
                    impact.totalMonthlyBurnMinor,
                  )}
            </strong>
            <small>
              {impact === null || !hasDraftChanges
                ? "Current saved result"
                : `${runwayChange >= 0 ? "+" : ""}${runwayChange} months`}
            </small>
          </article>
          <article>
            <span>Total monthly burn</span>
            <strong>
              {impact === null
                ? "—"
                : formatCompactMoney(impact.totalMonthlyBurnMinor)}
            </strong>
            <small>Household plus business</small>
          </article>
          <article>
            <span>Above cash floor</span>
            <strong>
              {impact === null
                ? "—"
                : formatCompactMoney(impact.liquidAfterCashFloorMinor)}
            </strong>
            <small>Available for runway</small>
          </article>
        </div>

        <label className="field field--wide plan-inputs__change-note">
          <span>What changed</span>
          <input
            maxLength={500}
            onChange={(event) => {
              setChangeNote(event.target.value);
              setSaveState("idle");
              setSaveMessage(null);
            }}
            value={changeNote ?? automaticChangeNote}
          />
        </label>

        {saveMessage !== null && (
          <p
            className={
              saveState === "error" ? "form-message error" : "form-message"
            }
            role={saveState === "error" ? "alert" : "status"}
          >
            {saveMessage}
          </p>
        )}

        <div className="plan-inputs__actions">
          {saveState === "error" && (
            <Button onClick={reloadLatest} tone="quiet">
              Reload latest
            </Button>
          )}
          <Button
            disabled={!hasDraftChanges || saveState === "saving"}
            onClick={resetDraft}
            tone="quiet"
          >
            Reset
          </Button>
          <Button
            disabled={
              !hasDraftChanges ||
              impact === null ||
              effectiveChangeNote.length === 0 ||
              saveState === "saving"
            }
            tone="primary"
            type="submit"
          >
            {saveState === "saving" ? "Saving…" : "Save plan"}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
