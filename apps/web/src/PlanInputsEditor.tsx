import {
  createPlanInputImpact,
  type CashFlowPlanSuggestion,
  type PlanInputSave,
  type PlanInputState,
} from "@keel/domain";
import {
  ActionGroup,
  Badge,
  Button,
  Field,
  FormMessage,
  Input,
  InputGroup,
  Notice,
  Panel,
  Stat,
  StatGroup,
} from "@keel/ui";
import { useEffect, useMemo, useRef, useState } from "react";

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
  suggestion,
  suggestionVersion,
}: {
  onSaved: () => Promise<void>;
  suggestion: CashFlowPlanSuggestion | null;
  suggestionVersion: number;
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
  const [cashFlowProposalId, setCashFlowProposalId] = useState<string | null>(
    null,
  );
  const appliedSuggestionVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadPlanInputs(controller.signal)
      .then((nextPlan) => {
        setPlan(nextPlan);
        setDraft(draftFromPlan(nextPlan));
        setChangeNote(null);
        setCashFlowProposalId(null);
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

  useEffect(() => {
    if (
      plan === null ||
      draft === null ||
      suggestion === null ||
      suggestionVersion <= appliedSuggestionVersion.current
    ) {
      return;
    }
    appliedSuggestionVersion.current = suggestionVersion;
    setDraft({
      householdBurnMonthly: moneyInputValue(
        suggestion.householdBurnMonthlyMinor,
      ),
      businessBurnMonthly: moneyInputValue(suggestion.businessBurnMonthlyMinor),
      protectedCashFloor: moneyInputValue(plan.values.protectedCashFloorMinor),
    });
    setChangeNote(suggestion.changeNote);
    setCashFlowProposalId(suggestion.proposalId);
    setSaveState("idle");
    setSaveMessage(
      "Observed burn is loaded as a draft. Review it before saving.",
    );
  }, [draft, plan, suggestion, suggestionVersion]);

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
    setCashFlowProposalId(null);
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
    setCashFlowProposalId(null);
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
      ...(cashFlowProposalId === null ? {} : { cashFlowProposalId }),
    };
    setSaveState("saving");
    setSaveMessage(null);
    void savePlanInputs(input)
      .then(async (result) => {
        setCashFlowProposalId(null);
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
        <Notice tone="error">{loadError}</Notice>
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

      <StatGroup
        aria-label="Plan-owned values"
        className="plan-inputs__context"
      >
        <Stat
          detail="From Holdings"
          label="FI-eligible liquid"
          value={formatCompactMoney(plan.fiEligibleLiquidMinor)}
        />
        <Stat
          detail="From Goals"
          label="FI target"
          value={formatCompactMoney(plan.fiTargetMinor)}
        />
        <Stat
          detail={`Through ${formatDate(plan.forecastHorizonDate)}`}
          label="Forecast base"
          value={`Version ${plan.baseForecastSnapshotVersion}`}
        />
      </StatGroup>

      <form
        className="plan-inputs__form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="plan-inputs__fields">
          <Field
            description="Personal operating costs"
            label="Household burn / month"
          >
            <InputGroup prefix="$">
              <Input
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
            </InputGroup>
          </Field>
          <Field
            description="Business costs covered by the plan"
            label="Business burn / month"
          >
            <InputGroup prefix="$">
              <Input
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
            </InputGroup>
          </Field>
          <Field
            description="Excluded before runway is calculated"
            label="Protected cash floor"
          >
            <InputGroup prefix="$">
              <Input
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
            </InputGroup>
          </Field>
        </div>

        <StatGroup className="plan-inputs__preview" aria-live="polite">
          <Stat
            detail={
              impact === null || !hasDraftChanges
                ? "Current saved result"
                : `${runwayChange >= 0 ? "+" : ""}${runwayChange} months`
            }
            label="Protected runway"
            value={
              impact === null
                ? "Check values"
                : runwayLabel(
                    impact.protectedRunwayMonths,
                    impact.totalMonthlyBurnMinor,
                  )
            }
          />
          <Stat
            detail="Household plus business"
            label="Total monthly burn"
            value={
              impact === null
                ? "—"
                : formatCompactMoney(impact.totalMonthlyBurnMinor)
            }
          />
          <Stat
            detail="Available for runway"
            label="Above cash floor"
            value={
              impact === null
                ? "—"
                : formatCompactMoney(impact.liquidAfterCashFloorMinor)
            }
          />
        </StatGroup>

        <Field className="plan-inputs__change-note" label="What changed" wide>
          <Input
            maxLength={500}
            onChange={(event) => {
              setChangeNote(event.target.value);
              setSaveState("idle");
              setSaveMessage(null);
            }}
            value={changeNote ?? automaticChangeNote}
          />
        </Field>

        {saveMessage !== null && (
          <FormMessage tone={saveState === "error" ? "error" : "neutral"}>
            {saveMessage}
          </FormMessage>
        )}

        <ActionGroup
          align="end"
          className="plan-inputs__actions"
          mobileLayout="grid"
        >
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
        </ActionGroup>
      </form>
    </Panel>
  );
}
