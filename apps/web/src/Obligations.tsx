import {
  createLiabilityImpact,
  type AcceptedLiability,
  type LiabilitiesState,
  type LiabilityPaymentTreatment,
  type LiabilityProposal,
  type ManualLiabilityInput,
} from "@keel/domain";
import {
  ActionGroup,
  Badge,
  Button,
  DatePicker,
  EmptyState,
  Field,
  FormMessage,
  Input,
  InputGroup,
  Notice,
  PageHeader,
  Screen,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatGroup,
} from "@keel/ui";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applyLiabilityProposal,
  createLiabilityLinkToken,
  disconnectLiabilities,
  exchangeLiabilityPublicToken,
  loadLiabilities,
  refreshLiabilities,
  stageManualLiability,
} from "./api";
import {
  formatCompactMoney,
  formatDate,
  formatMoney,
  formatProbability,
} from "./format";
import { openPlaidLink } from "./plaid-link";

const LINK_TOKEN_STORAGE_KEY = "keel.liabilityLinkToken";
const OAUTH_FLOW_STORAGE_KEY = "keel.plaidOauthFlow";
const OAUTH_FLOW = "liabilities";

type ReviewSelection = {
  included: boolean;
  treatment: LiabilityPaymentTreatment;
};

function kindLabel(kind: LiabilityProposal["rows"][number]["kind"]): string {
  return {
    credit_card: "Credit card",
    mortgage: "Mortgage",
    student_loan: "Student loan",
    other_revolving: "Other revolving",
    other_scheduled: "Other scheduled",
  }[kind];
}

function valueLabel(value: number | null): string {
  return value === null ? "Unknown" : formatMoney(value);
}

function paymentLabel(value: number | null): string {
  return value === null ? "Payment unknown" : `${formatMoney(value)} next`;
}

function treatmentLabel(treatment: LiabilityPaymentTreatment): string {
  return {
    reserve_from_liquidity: "Reserve next payment from liquidity",
    add_to_household_burn: "Add next payment to monthly burn",
    already_in_plan: "Already included in the plan",
  }[treatment];
}

const liabilityKindOptions = [
  { label: "Credit card", value: "credit_card" },
  { label: "Mortgage", value: "mortgage" },
  { label: "Student loan", value: "student_loan" },
  { label: "Other revolving", value: "other_revolving" },
  { label: "Other scheduled", value: "other_scheduled" },
] satisfies ReadonlyArray<{
  label: string;
  value: ManualLiabilityInput["kind"];
}>;

const paymentStatusOptions = [
  { label: "Unknown", value: "unknown" },
  { label: "Current", value: "no" },
  { label: "Overdue", value: "yes" },
] as const;

function defaultTreatment(
  row: LiabilityProposal["rows"][number],
): LiabilityPaymentTreatment {
  if (row.paymentMinor === null) return "already_in_plan";
  return row.classification === "revolving"
    ? "reserve_from_liquidity"
    : "add_to_household_burn";
}

function actionLabel(row: LiabilityProposal["rows"][number]): string {
  return {
    new_obligation: "New obligation",
    update_obligation:
      row.priorBalanceMinor === null
        ? "Previously unknown"
        : `Previously ${formatMoney(row.priorBalanceMinor)}`,
    no_change: "No reported change",
    not_reported: "Missing from this retrieval",
    needs_attention: "Cannot be accepted",
  }[row.action];
}

function previewLiabilities(
  state: LiabilitiesState,
  proposal: LiabilityProposal,
  selections: Readonly<Record<string, ReviewSelection>>,
): AcceptedLiability[] {
  const next = new Map(
    state.acceptedLiabilities.map((liability) => [
      liability.naturalKeySha256,
      liability,
    ]),
  );
  for (const row of proposal.rows) {
    const selection = selections[row.id];
    if (
      selection === undefined ||
      !selection.included ||
      row.valueState === "unsupported"
    ) {
      continue;
    }
    next.set(row.naturalKeySha256, {
      id: `draft-${row.id}`,
      naturalKeySha256: row.naturalKeySha256,
      connectionId: proposal.connectionId,
      source: row.source,
      institutionLabel: row.institutionLabel,
      accountLabel: row.accountLabel,
      kind: row.kind,
      classification: row.classification,
      balanceMinor: row.balanceMinor,
      valueState: row.valueState,
      paymentMinor: row.paymentMinor,
      paymentTreatment: selection.treatment,
      interestRatePpm: row.interestRatePpm,
      nextPaymentDueDate: row.nextPaymentDueDate,
      isOverdue: row.isOverdue,
      effectiveDate: row.effectiveDate,
      observedAt: row.observedAt,
      retrievedAt: proposal.retrievedAt,
      acceptedAt: proposal.retrievedAt,
      freshness: "current",
    });
  }
  return [...next.values()];
}

function ObligationReview({
  onApplied,
  onCancel,
  proposal,
  state,
}: {
  onApplied: (next: LiabilitiesState) => void;
  onCancel: () => void;
  proposal: LiabilityProposal;
  state: LiabilitiesState;
}) {
  const [selections, setSelections] = useState<Record<string, ReviewSelection>>(
    () =>
      Object.fromEntries(
        proposal.rows.map((row) => [
          row.id,
          {
            included: row.valueState !== "unsupported",
            treatment: defaultTreatment(row),
          },
        ]),
      ),
  );
  const [changeNote, setChangeNote] = useState(
    `Reviewed ${proposal.institutionLabel} obligations and payment treatment.`,
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => headingRef.current?.focus(), []);

  const preview = useMemo(
    () =>
      createLiabilityImpact(
        state.planning,
        previewLiabilities(state, proposal, selections),
      ),
    [proposal, selections, state],
  );

  const apply = async () => {
    setWorking(true);
    setError(null);
    try {
      await applyLiabilityProposal(proposal.id, {
        changeNote: changeNote.trim(),
        decisions: proposal.rows.map((row) => {
          const selection = selections[row.id];
          const included = selection?.included ?? false;
          return {
            rowId: row.id,
            decision: included ? "accepted" : "excluded",
            paymentTreatment: included
              ? (selection?.treatment ?? defaultTreatment(row))
              : null,
          };
        }),
      });
      onApplied(await loadLiabilities());
    } catch (applyError: unknown) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "The obligation review could not be applied.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      aria-labelledby="obligation-review-title"
      className="obligation-review"
    >
      <SectionHeader
        className="obligation-review__heading"
        description={
          <>
            Retrieved {formatDate(proposal.retrievedAt)}. Confirm each balance
            and decide whether its next payment changes liquidity or monthly
            burn.
          </>
        }
        eyebrow="Obligation review"
        headingProps={{
          id: "obligation-review-title",
          ref: headingRef,
          tabIndex: -1,
        }}
        title={`Review ${proposal.institutionLabel}`}
      />

      <StatGroup
        aria-label="Draft planning impact"
        className="obligation-review__impact"
      >
        <Stat
          as="span"
          detail={
            preview.reservedPaymentMinor === 0
              ? "No payment reserve"
              : `${formatMoney(preview.reservedPaymentMinor)} reserved`
          }
          detailAs="i"
          label="Net liquidity"
          labelAs="small"
          value={formatCompactMoney(preview.netLiquidityMinor)}
        />
        <Stat
          as="span"
          detail={
            preview.addedHouseholdBurnMinor === 0
              ? "No added payment"
              : `+${formatMoney(preview.addedHouseholdBurnMinor)} monthly`
          }
          detailAs="i"
          label="Household burn"
          labelAs="small"
          value={formatCompactMoney(preview.adjustedHouseholdBurnMonthlyMinor)}
        />
        <Stat
          as="span"
          detail="After the cash floor"
          detailAs="i"
          label="Protected runway"
          labelAs="small"
          value={`${preview.protectedRunwayMonths} mo`}
        />
        <Stat
          as="span"
          detail="After reviewed payments"
          detailAs="i"
          label="FI gap"
          labelAs="small"
          value={formatCompactMoney(preview.obligationAdjustedFiGapMinor)}
        />
      </StatGroup>

      <div className="obligation-review__rows">
        {proposal.rows.map((row) => {
          const selection = selections[row.id] ?? {
            included: false,
            treatment: defaultTreatment(row),
          };
          const canAccept = row.valueState !== "unsupported";
          const treatments: LiabilityPaymentTreatment[] =
            row.paymentMinor === null
              ? ["already_in_plan"]
              : row.classification === "revolving"
                ? ["reserve_from_liquidity", "already_in_plan"]
                : ["add_to_household_burn", "already_in_plan"];
          return (
            <article key={row.id}>
              <div className="obligation-review__identity">
                <span>{kindLabel(row.kind)}</span>
                <strong>{row.accountLabel}</strong>
                <small>
                  {actionLabel(row)} · values effective{" "}
                  {formatDate(row.effectiveDate)}
                </small>
                {row.issues.length > 0 && <p>{row.issues.join(" ")}</p>}
              </div>
              <StatGroup className="obligation-review__facts">
                <Stat
                  as="span"
                  label="Outstanding"
                  labelAs="small"
                  value={valueLabel(row.balanceMinor)}
                />
                <Stat
                  as="span"
                  label="Payment"
                  labelAs="small"
                  value={paymentLabel(row.paymentMinor)}
                />
                <Stat
                  as="span"
                  label="Due"
                  labelAs="small"
                  value={
                    row.nextPaymentDueDate === null
                      ? "Unknown"
                      : formatDate(row.nextPaymentDueDate)
                  }
                />
              </StatGroup>
              <div className="obligation-review__decision">
                <label>
                  <Input
                    checked={selection.included}
                    disabled={!canAccept || working}
                    onChange={(event) =>
                      setSelections((current) => ({
                        ...current,
                        [row.id]: {
                          ...selection,
                          included: event.currentTarget.checked,
                        },
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    {canAccept ? "Use this obligation" : "Cannot use this row"}
                  </span>
                </label>
                {selection.included && (
                  <Select
                    disabled={working}
                    items={treatments.map((treatment) => ({
                      label: treatmentLabel(treatment),
                      value: treatment,
                    }))}
                    onValueChange={(value) => {
                      if (
                        value !== "reserve_from_liquidity" &&
                        value !== "add_to_household_burn" &&
                        value !== "already_in_plan"
                      ) {
                        return;
                      }
                      setSelections((current) => ({
                        ...current,
                        [row.id]: {
                          ...selection,
                          treatment: value,
                        },
                      }));
                    }}
                    value={selection.treatment}
                  >
                    <SelectTrigger
                      aria-label={`Planning treatment for ${row.accountLabel}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {treatments.map((treatment) => (
                        <SelectItem key={treatment} value={treatment}>
                          {treatmentLabel(treatment)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <Field
        className="obligation-review__note"
        htmlFor="obligation-review-note"
        label="Review note"
      >
        <Input
          id="obligation-review-note"
          maxLength={500}
          onChange={(event) => setChangeNote(event.currentTarget.value)}
          value={changeNote}
        />
      </Field>
      {error !== null && <Notice tone="error">{error}</Notice>}
      <ActionGroup
        as="footer"
        className="obligation-review__actions"
        layout="split"
        mobileLayout="stack"
      >
        <p>Only the selected payment treatments affect this planning view.</p>
        <ActionGroup align="end" mobileLayout="grid">
          <Button disabled={working} onClick={onCancel} tone="quiet">
            Review later
          </Button>
          <Button
            disabled={working || changeNote.trim().length === 0}
            onClick={() => void apply()}
            tone="primary"
          >
            {working ? "Applying…" : "Apply review"}
          </Button>
        </ActionGroup>
      </ActionGroup>
    </section>
  );
}

function moneyInput(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/u.exec(
    value.trim().replaceAll(",", ""),
  );
  if (match === null) throw new Error("Enter a non-negative dollar amount.");
  const minor =
    BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("That amount is too large.");
  }
  return Number(minor);
}

function optionalMoneyInput(value: string): number | null {
  return value.trim() === "" ? null : moneyInput(value);
}

function optionalRateInput(value: string): number | null {
  const normalized = value.trim();
  if (normalized === "") return null;
  const match = /^(\d{1,3})(?:\.(\d{0,4}))?$/u.exec(normalized);
  if (match === null) throw new Error("Enter an APR from 0% to 100%.");
  const ppm = Number(
    BigInt(match[1] ?? "0") * 10_000n + BigInt((match[2] ?? "").padEnd(4, "0")),
  );
  if (ppm > 1_000_000) throw new Error("Enter an APR from 0% to 100%.");
  return ppm;
}

function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function ManualObligationForm({
  onCancel,
  onStaged,
}: {
  onCancel: () => void;
  onStaged: (proposalId: string) => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ManualLiabilityInput["kind"]>("credit_card");
  const today = new Date().toISOString().slice(0, 10);
  const [dueDate, setDueDate] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(today);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const form = new FormData(event.currentTarget);
      const overdue = formText(form, "overdue");
      const proposal = await stageManualLiability({
        institutionLabel: formText(form, "institutionLabel"),
        accountLabel: formText(form, "accountLabel"),
        kind,
        balanceMinor: optionalMoneyInput(formText(form, "balance")),
        paymentMinor: optionalMoneyInput(formText(form, "payment")),
        interestRatePpm: optionalRateInput(formText(form, "rate")),
        nextPaymentDueDate: dueDate || null,
        isOverdue: overdue === "unknown" ? null : overdue === "yes",
        effectiveDate,
      });
      await onStaged(proposal.id);
    } catch (submitError: unknown) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The obligation could not be prepared for review.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      aria-labelledby="manual-obligation-title"
      className="manual-obligation"
    >
      <SectionHeader
        description="Enter only the values you can support. Blank amounts stay unknown."
        eyebrow="Manual fallback"
        headingProps={{ id: "manual-obligation-title" }}
        title="Add an obligation"
      />
      <form onSubmit={(event) => void submit(event)}>
        <div className="manual-obligation__fields">
          <Field label="Institution">
            <Input maxLength={512} name="institutionLabel" required />
          </Field>
          <Field label="Account label">
            <Input maxLength={512} name="accountLabel" required />
          </Field>
          <Field label="Type">
            <Select
              items={liabilityKindOptions}
              name="kind"
              onValueChange={(value) => {
                if (
                  value === "credit_card" ||
                  value === "mortgage" ||
                  value === "student_loan" ||
                  value === "other_revolving" ||
                  value === "other_scheduled"
                ) {
                  setKind(value);
                }
              }}
              value={kind}
            >
              <SelectTrigger aria-label="Type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {liabilityKindOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Outstanding balance">
            <InputGroup prefix="$">
              <Input inputMode="decimal" name="balance" placeholder="Unknown" />
            </InputGroup>
          </Field>
          <Field label="Next required payment">
            <InputGroup prefix="$">
              <Input inputMode="decimal" name="payment" placeholder="Unknown" />
            </InputGroup>
          </Field>
          <Field label="APR">
            <InputGroup suffix="%">
              <Input inputMode="decimal" name="rate" placeholder="Unknown" />
            </InputGroup>
          </Field>
          <Field label="Next payment due">
            {(control) => (
              <DatePicker
                {...control}
                aria-label="Next payment due"
                value={dueDate}
                onValueChange={setDueDate}
                disabled={working}
              />
            )}
          </Field>
          <Field label="Payment status">
            <Select
              defaultValue="unknown"
              items={paymentStatusOptions}
              name="overdue"
            >
              <SelectTrigger aria-label="Payment status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentStatusOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Values effective">
            {(control) => (
              <DatePicker
                {...control}
                aria-label="Values effective"
                value={effectiveDate}
                onValueChange={setEffectiveDate}
                required
                disabled={working}
              />
            )}
          </Field>
        </div>
        {error !== null && <Notice tone="error">{error}</Notice>}
        <ActionGroup as="footer" layout="split" mobileLayout="stack">
          <p>
            You will review the planning treatment before anything is accepted.
          </p>
          <ActionGroup align="end" mobileLayout="grid">
            <Button disabled={working} onClick={onCancel} tone="quiet">
              Cancel
            </Button>
            <Button disabled={working} tone="primary" type="submit">
              {working ? "Preparing…" : "Continue to review"}
            </Button>
          </ActionGroup>
        </ActionGroup>
      </form>
    </section>
  );
}

export function Obligations() {
  const [state, setState] = useState<LiabilitiesState | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [disconnectId, setDisconnectId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).has("oauth_state_id") &&
      window.sessionStorage.getItem(OAUTH_FLOW_STORAGE_KEY) === OAUTH_FLOW &&
      window.sessionStorage.getItem(LINK_TOKEN_STORAGE_KEY) === null
      ? "Reconnect the institution to finish signing in."
      : null;
  });
  const oauthStarted = useRef(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await loadLiabilities(signal);
    setState(next);
    setError(null);
    return next;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void reload(controller.signal).catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Keel could not load obligations.",
          );
        }
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [reload]);

  const acceptState = useCallback((next: LiabilitiesState) => {
    setState(next);
    setError(null);
    const pending = next.pendingProposals[0];
    if (pending !== undefined) {
      setActiveProposalId(pending.id);
      setNotice(null);
    } else {
      setNotice("Obligations checked. No review is waiting.");
    }
  }, []);

  const exchangeToken = useCallback(
    async (publicToken: string) => {
      setBusyAction("exchange");
      setError(null);
      try {
        const next = await exchangeLiabilityPublicToken(publicToken);
        window.sessionStorage.removeItem(LINK_TOKEN_STORAGE_KEY);
        window.sessionStorage.removeItem(OAUTH_FLOW_STORAGE_KEY);
        if (window.location.search.length > 0) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        acceptState(next);
      } catch (exchangeError: unknown) {
        setError(
          exchangeError instanceof Error
            ? exchangeError.message
            : "The obligation connection could not be completed.",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [acceptState],
  );

  const openLink = useCallback(
    async (linkToken: string, receivedRedirectUri?: string) => {
      await openPlaidLink({
        linkToken,
        onExit: () => setBusyAction(null),
        onSuccess: (publicToken) => {
          if (publicToken === null) {
            setBusyAction(null);
            setError(
              "The obligation institution did not return a connection token.",
            );
            return;
          }
          void exchangeToken(publicToken);
        },
        ...(receivedRedirectUri === undefined ? {} : { receivedRedirectUri }),
      });
    },
    [exchangeToken],
  );

  useEffect(() => {
    if (
      oauthStarted.current ||
      !new URLSearchParams(window.location.search).has("oauth_state_id") ||
      window.sessionStorage.getItem(OAUTH_FLOW_STORAGE_KEY) !== OAUTH_FLOW
    ) {
      return;
    }
    const linkToken = window.sessionStorage.getItem(LINK_TOKEN_STORAGE_KEY);
    if (linkToken === null) return;
    const timer = window.setTimeout(() => {
      if (oauthStarted.current) return;
      oauthStarted.current = true;
      setBusyAction("connect");
      void openLink(linkToken, window.location.href).catch(() => {
        setBusyAction(null);
        setError("The obligation connection could not be reopened.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openLink]);

  const connect = async () => {
    setBusyAction("connect");
    setNotice(null);
    setError(null);
    try {
      const token = await createLiabilityLinkToken();
      window.sessionStorage.setItem(LINK_TOKEN_STORAGE_KEY, token.linkToken);
      window.sessionStorage.setItem(OAUTH_FLOW_STORAGE_KEY, OAUTH_FLOW);
      await openLink(token.linkToken);
    } catch (connectError: unknown) {
      setBusyAction(null);
      setError(
        connectError instanceof Error
          ? connectError.message
          : "The obligation connection could not be opened.",
      );
    }
  };

  const check = async (connectionId: string) => {
    setBusyAction(connectionId);
    setNotice(null);
    setError(null);
    try {
      acceptState(await refreshLiabilities(connectionId));
    } catch (refreshError: unknown) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Obligations could not be checked.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const disconnect = async (connectionId: string) => {
    setBusyAction(`disconnect-${connectionId}`);
    setError(null);
    try {
      setState(await disconnectLiabilities(connectionId));
      setDisconnectId(null);
      setNotice(
        "Institution disconnected. Reviewed obligations remain visible.",
      );
    } catch (disconnectError: unknown) {
      setError(
        disconnectError instanceof Error
          ? disconnectError.message
          : "The institution could not be disconnected.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const activeProposal =
    state?.pendingProposals.find(
      (proposal) => proposal.id === activeProposalId,
    ) ?? null;

  if (state === null) {
    return (
      <Screen>
        <PageHeader
          description="Loading reviewed debt and payment context…"
          eyebrow="Liquidity commitments"
          title="Obligations"
        />
        {error !== null && <Notice tone="error">{error}</Notice>}
      </Screen>
    );
  }

  return (
    <Screen className="obligations-page">
      <PageHeader
        actions={
          <>
            <Button onClick={() => setShowManual(true)} tone="secondary">
              Add manually
            </Button>
            {state.configured && (
              <Button
                disabled={busyAction !== null}
                onClick={() => void connect()}
                tone="primary"
              >
                {busyAction === "connect" || busyAction === "exchange"
                  ? "Connecting…"
                  : state.connections.length === 0
                    ? "Connect institution"
                    : "Add institution"}
              </Button>
            )}
          </>
        }
        description="Review debt balances and next payments without treating every outstanding dollar as an immediate cash outflow."
        eyebrow="Liquidity commitments"
        title="Obligations"
      />

      {!state.configured && (
        <p className="obligations-page__setup">
          Institution import needs Plaid settings. Manual review is available.
        </p>
      )}

      <StatGroup
        aria-label="Reviewed obligation impact"
        as="section"
        className="obligations-impact"
      >
        <Stat
          detail={
            state.impact.unknownBalanceCount === 0
              ? `${state.impact.liabilityCount} reviewed`
              : `${state.impact.unknownBalanceCount} unknown`
          }
          label="Outstanding reported"
          value={formatCompactMoney(state.impact.totalOutstandingMinor)}
        />
        <Stat
          detail={
            state.impact.reservedPaymentMinor === 0
              ? "No next-payment reserve"
              : `${formatMoney(state.impact.reservedPaymentMinor)} reserved`
          }
          label="Net liquidity"
          value={formatCompactMoney(state.impact.netLiquidityMinor)}
        />
        <Stat
          detail={
            state.impact.addedHouseholdBurnMinor === 0
              ? "No reviewed debt added"
              : `+${formatMoney(state.impact.addedHouseholdBurnMinor)} monthly`
          }
          label="Household burn"
          value={formatCompactMoney(
            state.impact.adjustedHouseholdBurnMonthlyMinor,
          )}
        />
        <Stat
          detail={`FI gap ${formatCompactMoney(
            state.impact.obligationAdjustedFiGapMinor,
          )}`}
          label="Protected runway"
          value={`${state.impact.protectedRunwayMonths} mo`}
        />
      </StatGroup>

      {showManual && (
        <ManualObligationForm
          onCancel={() => setShowManual(false)}
          onStaged={async (proposalId) => {
            setShowManual(false);
            await reload();
            setActiveProposalId(proposalId);
          }}
        />
      )}

      {activeProposal !== null && (
        <ObligationReview
          key={activeProposal.id}
          onApplied={(next) => {
            setState(next);
            setActiveProposalId(null);
            setNotice("Obligation review applied to this planning view.");
          }}
          onCancel={() => setActiveProposalId(null)}
          proposal={activeProposal}
          state={state}
        />
      )}

      {state.pendingProposals.length > 0 && activeProposal === null && (
        <section
          aria-labelledby="pending-obligations-title"
          className="obligations-pending"
        >
          <SectionHeader
            eyebrow="Waiting for review"
            headingProps={{ id: "pending-obligations-title" }}
            title="Reported values are still proposals"
          />
          {state.pendingProposals.map((proposal) => (
            <div key={proposal.id}>
              <span>
                <strong>{proposal.institutionLabel}</strong>
                <small>
                  {proposal.summary.rowCount} obligations · retrieved{" "}
                  {formatDate(proposal.retrievedAt)}
                </small>
              </span>
              <Button
                onClick={() => setActiveProposalId(proposal.id)}
                tone="primary"
              >
                Review obligations
              </Button>
            </div>
          ))}
        </section>
      )}

      <section
        aria-labelledby="reviewed-obligations-title"
        className="reviewed-obligations"
      >
        <SectionHeader
          action={<span>{state.acceptedLiabilities.length} total</span>}
          eyebrow="Reviewed record"
          headingProps={{ id: "reviewed-obligations-title" }}
          title="Accepted obligations"
        />
        {state.acceptedLiabilities.length === 0 ? (
          <EmptyState
            className="reviewed-obligations__empty"
            compact
            headingAs="h3"
            icon={null}
            title="No obligations have been accepted."
          >
            Add one manually or connect an institution, then review the reported
            values.
          </EmptyState>
        ) : (
          <div className="reviewed-obligations__list">
            {state.acceptedLiabilities.map((liability) => (
              <article key={liability.id}>
                <div>
                  <span>{kindLabel(liability.kind)}</span>
                  <strong>{liability.accountLabel}</strong>
                  <small>
                    {liability.institutionLabel} · values effective{" "}
                    {formatDate(liability.effectiveDate)}
                  </small>
                </div>
                <StatGroup>
                  <Stat
                    as="span"
                    label="Outstanding"
                    labelAs="small"
                    value={valueLabel(liability.balanceMinor)}
                  />
                  <Stat
                    as="span"
                    label="Next payment"
                    labelAs="small"
                    value={valueLabel(liability.paymentMinor)}
                  />
                  <Stat
                    as="span"
                    label="APR"
                    labelAs="small"
                    value={
                      liability.interestRatePpm === null
                        ? "Unknown"
                        : formatProbability(liability.interestRatePpm)
                    }
                  />
                </StatGroup>
                <div className="reviewed-obligations__status">
                  <Badge
                    tone={
                      liability.freshness === "stale" ? "warning" : "neutral"
                    }
                  >
                    {liability.freshness === "stale" ? "Stale" : "Reviewed"}
                  </Badge>
                  {liability.isOverdue === true && (
                    <Badge tone="negative">Overdue</Badge>
                  )}
                  <small>{treatmentLabel(liability.paymentTreatment)}</small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {state.connections.length > 0 && (
        <section
          aria-labelledby="obligation-sources-title"
          className="obligation-sources"
        >
          <SectionHeader
            eyebrow="Institution access"
            headingProps={{ id: "obligation-sources-title" }}
            title="Connected institutions"
          />
          {state.connections.map((connection) => {
            const reviewWaiting = state.pendingProposals.some(
              (proposal) => proposal.connectionId === connection.id,
            );
            const confirming = disconnectId === connection.id;
            return (
              <div key={connection.id}>
                <span>
                  <strong>{connection.institutionLabel}</strong>
                  <small>
                    {connection.lastCheckedAt === null
                      ? "Not checked yet"
                      : `Last checked ${formatDate(connection.lastCheckedAt)}`}{" "}
                    · {connection.liveRefreshesRemaining} checks left this month
                  </small>
                  {confirming && (
                    <em>
                      Disconnecting removes Plaid access. Reviewed obligations
                      stay in Keel.
                    </em>
                  )}
                </span>
                <div>
                  {confirming ? (
                    <>
                      <Button
                        disabled={busyAction !== null}
                        onClick={() => setDisconnectId(null)}
                        tone="quiet"
                      >
                        Keep connected
                      </Button>
                      <Button
                        disabled={busyAction !== null}
                        onClick={() => void disconnect(connection.id)}
                        tone="danger"
                      >
                        {busyAction === `disconnect-${connection.id}`
                          ? "Disconnecting…"
                          : "Disconnect"}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        disabled={busyAction !== null}
                        onClick={() => setDisconnectId(connection.id)}
                        tone="quiet"
                      >
                        Disconnect
                      </Button>
                      <Button
                        disabled={
                          busyAction !== null ||
                          reviewWaiting ||
                          connection.liveRefreshesRemaining === 0
                        }
                        onClick={() => void check(connection.id)}
                        tone="secondary"
                      >
                        {busyAction === connection.id
                          ? "Checking…"
                          : reviewWaiting
                            ? "Review waiting"
                            : "Check obligations"}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <p className="obligation-sources__cost">
            Plaid bills Liabilities monthly while an institution remains
            connected. Keel retrieves on connect and only when you ask, up to
            four times per institution each month.
          </p>
        </section>
      )}

      {notice !== null && (
        <FormMessage className="obligations-page__notice" tone="success">
          {notice}
        </FormMessage>
      )}
      {error !== null && (
        <FormMessage className="obligations-page__error" tone="error">
          {error}
        </FormMessage>
      )}
    </Screen>
  );
}
