import {
  addMinorUnits,
  createCashFlowComparison,
  type CashFlowPlanSuggestion,
  type CashFlowProposal,
  type CashFlowState,
  type CashFlowTreatment,
} from "@keel/domain";
import {
  Badge,
  Button,
  Field,
  FormMessage,
  Input,
  Notice,
  Panel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@keel/ui";
import { useEffect, useMemo, useState } from "react";

import {
  disconnectCashAccount,
  loadCashFlow,
  reviewCashFlow,
  syncCashFlow,
} from "./api";
import { formatCompactMoney, formatDate } from "./format";

const treatmentLabels: Record<CashFlowTreatment, string> = {
  household: "Household burn",
  business: "Business burn",
  excluded: "Exclude from burn",
  debt_payment: "Debt payment",
};

const treatmentOptions = (
  Object.entries(treatmentLabels) as Array<[CashFlowTreatment, string]>
).map(([value, label]) => ({ label, value }));

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year ?? 0, (monthNumber ?? 1) - 1, 1)));
}

function roundedAverage(totalMinor: number): number {
  return Number((BigInt(totalMinor) + 1n) / 3n);
}

function draftComparison(
  proposal: CashFlowProposal,
  treatments: Readonly<Record<string, CashFlowTreatment>>,
) {
  const totals = proposal.categories.reduce(
    (result, category) => {
      const treatment =
        treatments[category.id] ??
        category.reviewedTreatment ??
        category.defaultTreatment;
      if (treatment === "household") {
        result.household = addMinorUnits(result.household, category.totalMinor);
      } else if (treatment === "business") {
        result.business = addMinorUnits(result.business, category.totalMinor);
      }
      return result;
    },
    { household: 0, business: 0 },
  );
  const observedLoanPaymentInBurn = proposal.categories.some((category) => {
    const treatment =
      treatments[category.id] ??
      category.reviewedTreatment ??
      category.defaultTreatment;
    return (
      category.category === "LOAN_PAYMENTS" &&
      (treatment === "household" || treatment === "business")
    );
  });
  return createCashFlowComparison(
    proposal.planning,
    roundedAverage(totals.household),
    roundedAverage(totals.business),
    !observedLoanPaymentInBurn,
  );
}

function outcomeCopy(state: CashFlowState): string {
  if (state.status === "needs_attention") {
    return "The last check did not finish. Review the issue and try again.";
  }
  switch (state.latestOutcome) {
    case "history_incomplete":
      return "A proposal needs spending in each of the last three complete months.";
    case "coverage_incomplete":
      return "Check every reviewed cash institution before comparing burn.";
    case "no_material_change":
      return "Observed burn does not differ enough to suggest a plan change.";
    case "proposal_ready":
      return "A burn proposal is ready for review.";
    case "never_checked":
      return "Start with the last three complete months.";
  }
}

export function ObservedCashFlow({
  onPreparePlanDraft,
  reloadKey,
}: {
  onPreparePlanDraft: (suggestion: CashFlowPlanSuggestion) => void;
  reloadKey: number;
}) {
  const [state, setState] = useState<CashFlowState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workingConnection, setWorkingConnection] = useState<string | null>(
    null,
  );
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [pricingConfirmed, setPricingConfirmed] = useState<
    Record<string, boolean>
  >({});
  const [treatments, setTreatments] = useState<
    Record<string, CashFlowTreatment>
  >({});
  const [changeNote, setChangeNote] = useState("Reviewed observed burn.");
  const [reviewing, setReviewing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = (signal?: AbortSignal) =>
    loadCashFlow(signal).then((next) => {
      setState(next);
      setLoadError(null);
      return next;
    });

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Observed cash flow could not be loaded.",
        );
      }
    });
    return () => controller.abort();
  }, [reloadKey]);

  const proposal = state?.pendingProposals[0] ?? null;

  const comparison = useMemo(
    () => (proposal === null ? null : draftComparison(proposal, treatments)),
    [proposal, treatments],
  );

  const check = async (connectionId: string, requiresConfirmation: boolean) => {
    setWorkingConnection(connectionId);
    setActionError(null);
    setMessage(null);
    try {
      const next = await syncCashFlow(
        connectionId,
        requiresConfirmation ? pricingConfirmed[connectionId] === true : false,
      );
      setState(next);
      setMessage(
        next.pendingProposals.length > 0
          ? "Observed burn is ready to review."
          : outcomeCopy(next),
      );
    } catch (error: unknown) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Observed cash flow could not be checked.",
      );
    } finally {
      setWorkingConnection(null);
    }
  };

  const review = async () => {
    if (proposal === null) {
      return;
    }
    setReviewing(true);
    setActionError(null);
    setMessage(null);
    try {
      const result = await reviewCashFlow(proposal.id, {
        changeNote: changeNote.trim(),
        decisions: proposal.categories.map((category) => ({
          categoryId: category.id,
          treatment: treatments[category.id] ?? category.defaultTreatment,
        })),
      });
      if (result.planSuggestion === null) {
        setState(await loadCashFlow());
        setMessage(
          "Review complete. The current burn plan remains reasonable.",
        );
      } else {
        onPreparePlanDraft(result.planSuggestion);
        setState(await loadCashFlow());
        setMessage("Plan draft prepared below. Review the runway, then save.");
      }
    } catch (error: unknown) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The cash-flow review could not be completed.",
      );
    } finally {
      setReviewing(false);
    }
  };

  const disconnect = async (connectionId: string) => {
    setWorkingConnection(connectionId);
    setActionError(null);
    setMessage(null);
    try {
      await disconnectCashAccount(connectionId);
      setState(await loadCashFlow());
      setDisconnectId(null);
      setMessage(
        "Bank access removed. Reviewed balances and plan history remain.",
      );
    } catch (error: unknown) {
      setActionError(
        error instanceof Error
          ? error.message
          : "The bank could not be disconnected.",
      );
    } finally {
      setWorkingConnection(null);
    }
  };

  if (loadError !== null) {
    return (
      <Panel
        className="cash-flow cash-flow--error"
        eyebrow="Observed cash flow"
        title="Cash flow is unavailable"
      >
        <Notice tone="error">{loadError}</Notice>
        <Button
          onClick={() => {
            setLoadError(null);
            setState(null);
            void refresh().catch((error: unknown) =>
              setLoadError(
                error instanceof Error
                  ? error.message
                  : "Observed cash flow could not be loaded.",
              ),
            );
          }}
        >
          Try again
        </Button>
      </Panel>
    );
  }

  if (state === null) {
    return (
      <Panel
        className="cash-flow"
        eyebrow="Observed cash flow"
        title="Burn check"
      >
        <p className="cash-flow__copy">Loading observed cash flow…</p>
      </Panel>
    );
  }

  if (proposal !== null && comparison !== null) {
    const currentTotal = addMinorUnits(
      proposal.planning.householdBurnMonthlyMinor,
      proposal.planning.businessBurnMonthlyMinor,
    );
    const proposedTotal = addMinorUnits(
      comparison.proposedHouseholdBurnMonthlyMinor,
      comparison.proposedBusinessBurnMonthlyMinor,
    );
    const readyForPlan = proposal.status === "ready_for_plan";
    return (
      <Panel
        action={
          <Badge tone={readyForPlan ? "positive" : "warning"}>
            {readyForPlan ? "Plan draft ready" : "Review needed"}
          </Badge>
        }
        className="cash-flow cash-flow-review"
        eyebrow="Observed cash flow"
        title="Compare burn"
      >
        <div className="cash-flow__heading">
          <p className="cash-flow__copy">
            Three complete months through {monthLabel(proposal.periodEndMonth)}.
            Choose how each category belongs in the runway plan.
          </p>
          <small>
            {proposal.transactionCount} posted outflows ·{" "}
            {proposal.coveredConnectionCount} reviewed{" "}
            {proposal.coveredConnectionCount === 1
              ? "institution"
              : "institutions"}
          </small>
        </div>

        <div className="cash-flow__comparison" aria-label="Burn comparison">
          <article>
            <span>Accepted burn</span>
            <strong>{formatCompactMoney(currentTotal)}</strong>
            <small>Per month</small>
          </article>
          <article>
            <span>Reviewed proposal</span>
            <strong>{formatCompactMoney(proposedTotal)}</strong>
            <small>
              {comparison.totalChangeMinor >= 0 ? "+" : ""}
              {formatCompactMoney(comparison.totalChangeMinor)} monthly
            </small>
          </article>
          <article>
            <span>Protected runway</span>
            <strong>{comparison.proposedRunwayMonths} mo</strong>
            <small>Currently {comparison.currentRunwayMonths} mo</small>
          </article>
        </div>

        <div className="cash-flow__months" aria-label="Complete month totals">
          {proposal.months.map((month) => (
            <span key={month.month}>
              <small>{monthLabel(month.month)}</small>
              <strong>{formatCompactMoney(month.outflowMinor)}</strong>
              <i>{month.transactionCount} posted</i>
            </span>
          ))}
        </div>

        <div className="cash-flow__categories">
          <header>
            <h3>Spending treatment</h3>
            <small>Monthly average</small>
          </header>
          {proposal.categories.map((category) => (
            <label className="cash-flow__category" key={category.id}>
              <span>
                <strong>{category.label}</strong>
                <small>
                  {category.transactionCount}{" "}
                  {category.transactionCount === 1
                    ? "transaction"
                    : "transactions"}
                </small>
              </span>
              <b>{formatCompactMoney(category.averageMonthlyMinor)}</b>
              <Select
                disabled={readyForPlan}
                items={treatmentOptions}
                onValueChange={(value) => {
                  if (
                    value !== "household" &&
                    value !== "business" &&
                    value !== "excluded" &&
                    value !== "debt_payment"
                  ) {
                    return;
                  }
                  setTreatments((current) => ({
                    ...current,
                    [category.id]: value,
                  }));
                  setMessage(null);
                  setActionError(null);
                }}
                value={
                  treatments[category.id] ??
                  category.reviewedTreatment ??
                  category.defaultTreatment
                }
              >
                <SelectTrigger aria-label={`${category.label} treatment`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {treatmentOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>

        {(proposal.pendingExcludedCount > 0 ||
          proposal.unsupportedExcludedCount > 0 ||
          proposal.unreviewedAccountExcludedCount > 0) && (
          <p className="cash-flow__exclusions">
            Not in this proposal: {proposal.pendingExcludedCount} pending,{" "}
            {proposal.unsupportedExcludedCount} unsupported currency, and{" "}
            {proposal.unreviewedAccountExcludedCount} from unreviewed accounts.
          </p>
        )}

        {!readyForPlan && (
          <Field className="cash-flow__note" label="Review note" wide>
            <Input
              maxLength={500}
              onChange={(event) => setChangeNote(event.target.value)}
              value={changeNote}
            />
          </Field>
        )}
        <p className="cash-flow__trust">
          Loan payments stay with Obligations by default. Nothing changes until
          the prepared plan is saved.
        </p>
        {actionError !== null && (
          <FormMessage tone="error">{actionError}</FormMessage>
        )}
        {message !== null && <FormMessage>{message}</FormMessage>}
        <div className="cash-flow__actions">
          {readyForPlan ? (
            <Button
              disabled={proposal.planSuggestion === null}
              onClick={() => {
                if (proposal.planSuggestion !== null) {
                  onPreparePlanDraft(proposal.planSuggestion);
                  setMessage(
                    "Plan draft prepared below. Review the runway, then save.",
                  );
                }
              }}
              tone="primary"
            >
              Load plan draft
            </Button>
          ) : (
            <Button
              disabled={reviewing || changeNote.trim().length === 0}
              onClick={() => void review()}
              tone="primary"
            >
              {reviewing ? "Preparing…" : "Prepare plan draft"}
            </Button>
          )}
        </div>
      </Panel>
    );
  }

  const sourceConnections = state.connections;
  return (
    <Panel
      action={
        <Badge
          tone={
            state.status === "needs_attention"
              ? "negative"
              : state.status === "consent_required"
                ? "warning"
                : "neutral"
          }
        >
          {state.status === "setup_required"
            ? "Setup needed"
            : state.status === "disconnected"
              ? "No cash account"
              : state.status === "waiting_for_cash_review"
                ? "Cash review needed"
                : state.status === "consent_required"
                  ? "Pricing confirmation"
                  : "No proposal"}
        </Badge>
      }
      className="cash-flow"
      eyebrow="Observed cash flow"
      title="Compare burn"
    >
      <p className="cash-flow__copy">
        {state.status === "setup_required"
          ? "Plaid settings are required before Keel can compare observed burn."
          : state.status === "disconnected"
            ? "Connect and review a cash account in Holdings first."
            : state.status === "waiting_for_cash_review"
              ? "Review a linked cash account in Holdings before using its activity."
              : outcomeCopy(state)}
      </p>

      {sourceConnections.map((connection) => {
        const needsCashReview = connection.acceptedAccountCount === 0;
        const needsConsent =
          !needsCashReview && connection.pricingConfirmedAt === null;
        const working = workingConnection === connection.id;
        const confirming = disconnectId === connection.id;
        return (
          <div className="cash-flow__source" key={connection.id}>
            <span>
              <strong>{connection.institutionLabel}</strong>
              <small>
                {connection.lastCheckedAt === null
                  ? `${connection.acceptedAccountCount} reviewed ${
                      connection.acceptedAccountCount === 1
                        ? "account"
                        : "accounts"
                    }`
                  : `Checked ${formatDate(connection.lastCheckedAt)} · ${connection.dailyChecksRemaining} checks left today`}
              </small>
            </span>
            {needsConsent && (
              <label className="cash-flow__consent">
                <Input
                  checked={pricingConfirmed[connection.id] === true}
                  onChange={(event) =>
                    setPricingConfirmed((current) => ({
                      ...current,
                      [connection.id]: event.target.checked,
                    }))
                  }
                  type="checkbox"
                />
                <span>
                  I confirmed this deployment’s Plaid Transactions price.
                  Starting activates its monthly subscription for this bank.
                </span>
              </label>
            )}
            <div className="cash-flow__source-actions">
              {confirming ? (
                <>
                  <small>
                    This removes all Plaid access and normalized transaction
                    history. Reviewed records remain.
                  </small>
                  <Button
                    disabled={working}
                    onClick={() => setDisconnectId(null)}
                    tone="quiet"
                  >
                    Keep connected
                  </Button>
                  <Button
                    disabled={working}
                    onClick={() => void disconnect(connection.id)}
                    tone="danger"
                  >
                    {working ? "Disconnecting…" : "Disconnect bank"}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    disabled={working}
                    onClick={() => setDisconnectId(connection.id)}
                    tone="quiet"
                  >
                    Disconnect
                  </Button>
                  <Button
                    disabled={
                      working ||
                      needsCashReview ||
                      connection.dailyChecksRemaining === 0 ||
                      (needsConsent && pricingConfirmed[connection.id] !== true)
                    }
                    onClick={() => void check(connection.id, needsConsent)}
                    tone={needsConsent ? "primary" : "secondary"}
                  >
                    {working
                      ? "Checking…"
                      : needsCashReview
                        ? "Review cash first"
                        : needsConsent
                          ? "Start comparison"
                          : "Check cash flow"}
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {sourceConnections.length > 0 && (
        <p className="cash-flow__trust">
          Raw descriptions are discarded. Checks use existing bank consent and
          never request a paid refresh.
        </p>
      )}
      {actionError !== null && (
        <FormMessage tone="error">{actionError}</FormMessage>
      )}
      {message !== null && <FormMessage>{message}</FormMessage>}
    </Panel>
  );
}
