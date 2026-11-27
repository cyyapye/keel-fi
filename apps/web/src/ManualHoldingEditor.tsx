import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Holding } from "@keel/domain";
import {
  ManualHoldingIdentityInputSchema,
  ManualHoldingInputSchema,
  ManualHoldingOptionsSchema,
  ManualHoldingReceiptSchema,
  ManualHoldingSubmissionSchema,
  type ManualHoldingOptions,
  type ManualHoldingReceipt,
} from "@keel/domain/manual-holdings";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DatePicker,
  DisclosureIndicator,
  Field,
  FormMessage,
  Input,
  LoadingStatus,
  PageHeader,
  RadioGroup,
  SearchSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  TextLink,
} from "@keel/ui";
import { z } from "zod";
import { requestKeel } from "./api-request";
import { scaled } from "./decimal-input";

type Draft = {
  name: string;
  kind: string;
  owner: string;
  ownerLabel: string;
  company: string;
  cash: string;
  investmentDate: string;
  value: string;
  valueDate: string;
  carry: string;
};
type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "checking" }
  | { kind: "unconfirmed"; message: string }
  | { kind: "stale"; message: string }
  | { kind: "rejected"; message: string }
  | { kind: "not_found" }
  | { kind: "saved"; receipt: ManualHoldingReceipt; message: string };
const StoredDraftSchema = z.object({
  submissionId: z.string().uuid(),
  draft: z.object({
    name: z.string(),
    kind: z.string(),
    owner: z.string(),
    ownerLabel: z.string(),
    company: z.string(),
    cash: z.string(),
    investmentDate: z.string(),
    value: z.string(),
    valueDate: z.string(),
    carry: z.string(),
  }),
  unconfirmed: z.boolean(),
  stale: z.boolean().default(false),
  receipt: ManualHoldingReceiptSchema.nullable(),
  identity: z
    .object({
      version: z.number().int().positive(),
      mappingIds: z.array(z.string().min(1)),
    })
    .nullable()
    .default(null),
});
function readStoredDraft(key: string) {
  try {
    const stored = sessionStorage.getItem(key);
    return stored ? StoredDraftSchema.parse(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}
const ErrorResponseSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
});
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
function moneyInput(value: string) {
  if (!value.trim()) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?$/u.test(value.trim()))
    return NaN;
  return scaled(value.replaceAll(",", ""), 2);
}
function initialDraft(holding?: Holding): Draft {
  return {
    name: holding?.positionName ?? "",
    kind: holding?.positionKind ?? "",
    owner: holding?.manualContext
      ? `container:${holding.manualContext.containerId}`
      : "",
    ownerLabel: "",
    company: holding?.companyId
      ? `company:${holding.companyId}`
      : holding?.manualContext?.companyMappingIds.length
        ? "unchanged"
        : "unassigned",
    cash: "",
    investmentDate: holding?.purchaseContext?.openedOn ?? "",
    value: "",
    valueDate: "",
    carry: "unknown",
  };
}

type ManualHoldingEditorProps = {
  request?: typeof requestKeel;
  holding?: Holding;
  onClose: () => void;
  onSaved: (receipt: ManualHoldingReceipt) => Promise<void>;
  onNavigationLockChange?: ((locked: boolean) => void) | undefined;
};

export function ManualHoldingEditor(props: ManualHoldingEditorProps) {
  const request = props.request ?? requestKeel;
  const [options, setOptions] = useState<ManualHoldingOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [reloadingChoices, setReloadingChoices] = useState(false);
  const reloadOptions = () => {
    setReloadingChoices(true);
    setLoadVersion((version) => version + 1);
  };
  useEffect(() => {
    const controller = new AbortController();
    void request("/api/manual-holdings/options", {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Owner and company choices could not be loaded. Try again.",
          );
        const result = ManualHoldingOptionsSchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setOptions(result);
          setLoadError(null);
          setReloadingChoices(false);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setReloadingChoices(false);
          setLoadError(
            error instanceof Error
              ? error.message
              : "Owner and company choices could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, [loadVersion, request]);
  if (options)
    return (
      <ManualHoldingForm
        key={`${options.householdScope}:${props.holding?.id ?? "new"}`}
        {...props}
        options={options}
        loadError={loadError}
        reloadingChoices={reloadingChoices}
        onReloadOptions={reloadOptions}
      />
    );
  return (
    <section
      className="manual-holding-workspace"
      aria-label={props.holding ? "Edit holding details" : "Add holding"}
    >
      <TextLink className="manual-holding-back" onClick={props.onClose}>
        Back to {props.holding ? "holding" : "holdings"}
      </TextLink>
      <PageHeader
        eyebrow="Holdings"
        title={props.holding ? "Edit holding details" : "Add holding"}
        description={
          props.holding
            ? `${props.holding.positionName} · ${props.holding.ownerLabel}`
            : "Record an investment you own. Add amounts when you know them."
        }
      />
      {loadError ? (
        <>
          <FormMessage tone="error">{loadError}</FormMessage>
          <Button onClick={reloadOptions} disabled={reloadingChoices}>
            Reload choices
          </Button>
        </>
      ) : (
        <LoadingStatus>Loading owner and company choices…</LoadingStatus>
      )}
    </section>
  );
}

function ManualHoldingForm({
  request = requestKeel,
  holding,
  onClose,
  onSaved,
  onNavigationLockChange,
  options,
  loadError,
  reloadingChoices,
  onReloadOptions,
}: ManualHoldingEditorProps & {
  options: ManualHoldingOptions;
  loadError: string | null;
  reloadingChoices: boolean;
  onReloadOptions: () => void;
}) {
  const storageKey = `keel:manual-holding:${options.householdScope}:${holding?.id ?? "new"}`;
  const [restored] = useState(() => readStoredDraft(storageKey));
  const [submissionId] = useState(
    () => restored?.submissionId ?? crypto.randomUUID(),
  );
  const [identityRevision] = useState(
    () =>
      restored?.identity ??
      (holding?.manualContext
        ? {
            version: holding.manualContext.version,
            mappingIds: holding.manualContext.companyMappingIds,
          }
        : null),
  );
  const [draft, setDraft] = useState(
    () => restored?.draft ?? initialDraft(holding),
  );
  const [state, setState] = useState<SaveState>(() =>
    restored?.receipt
      ? {
          kind: "saved",
          receipt: restored.receipt,
          message: "This holding was saved. Open its details to continue.",
        }
      : restored?.unconfirmed
        ? {
            kind: "unconfirmed",
            message:
              "Keel could not confirm the previous save. Check for this holding before trying again.",
          }
        : restored?.stale
          ? {
              kind: "stale",
              message:
                "This holding changed while you were editing. Cancel and reopen holding details to review the latest record before editing again.",
            }
          : { kind: "idle" },
  );
  const [detailsOpen, setDetailsOpen] = useState(() =>
    Boolean(
      restored?.draft.cash ||
      restored?.draft.investmentDate ||
      restored?.draft.value ||
      restored?.draft.valueDate,
    ),
  );
  const heading = useRef<HTMLInputElement>(null);
  const lock = useRef(onNavigationLockChange);
  useEffect(() => {
    lock.current = onNavigationLockChange;
  }, [onNavigationLockChange]);
  const busy = state.kind === "saving" || state.kind === "checking";
  const navigationLocked = busy || state.kind === "unconfirmed";
  const locked = navigationLocked || state.kind === "saved";
  const persistDraft = useCallback(
    (
      unconfirmed: boolean,
      receipt: ManualHoldingReceipt | null = null,
      stale = false,
    ) => {
      try {
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            submissionId,
            draft,
            unconfirmed,
            stale,
            receipt,
            identity: identityRevision,
          }),
        );
      } catch {
        // The live draft remains usable when browser storage is unavailable.
      }
    },
    [storageKey, submissionId, draft, identityRevision],
  );
  const clearDraft = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* Storage may be disabled. */
    }
  };
  const close = () => {
    clearDraft();
    onClose();
  };
  useEffect(() => {
    persistDraft(
      navigationLocked,
      state.kind === "saved" ? state.receipt : null,
      state.kind === "stale",
    );
  }, [persistDraft, navigationLocked, state]);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    lock.current?.(navigationLocked);
    return () => lock.current?.(false);
  }, [navigationLocked]);
  const update = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    if (state.kind === "rejected" || state.kind === "not_found")
      setState({ kind: "idle" });
  };
  const container = options?.containers.find(
    (item) => `container:${item.id}` === draft.owner,
  );
  const entity = options?.legalEntities.find(
    (item) => `entity:${item.id}` === draft.owner,
  );
  const company = options?.companies.find(
    (item) => `company:${item.id}` === draft.company,
  );
  const owner = container
    ? {
        mode: "existing",
        containerId: container.id,
        version: container.version,
      }
    : entity
      ? { mode: "entity", entityId: entity.id, version: entity.version }
      : { mode: "new", label: draft.owner === "new" ? draft.ownerLabel : "" };
  const companyChoice =
    holding &&
    (draft.company === "unchanged" ||
      (holding.manualContext?.companyMappingIds.length &&
        draft.company === initialDraft(holding).company))
      ? { mode: "unchanged" }
      : draft.company === "unassigned"
        ? { mode: "unassigned" }
        : {
            mode: "existing",
            companyId: company?.id ?? "",
            revision: company?.revision ?? "",
          };
  const rawIdentity = {
    submissionId,
    expectedVersion: identityRevision?.version,
    expectedMappingIds: identityRevision?.mappingIds,
    name: draft.name,
    kind: draft.kind,
    owner,
    company: companyChoice,
    investmentDate: holding?.purchaseContext?.openedOn ?? null,
  };
  const rawInput = {
    submissionId,
    classification: "private_paper",
    name: draft.name,
    kind: draft.kind,
    owner,
    company: companyChoice,
    cashPaidMinor: moneyInput(draft.cash),
    investmentDate: draft.investmentDate || null,
    valuation: !draft.value.trim()
      ? { state: "unknown" }
      : {
          state: "estimated",
          amountMinor: moneyInput(draft.value),
          effectiveDate: draft.valueDate,
          carryStatus: draft.kind === "direct" ? "unknown" : draft.carry,
        },
  };
  const parsed = holding
    ? ManualHoldingIdentityInputSchema.safeParse(rawIdentity)
    : ManualHoldingInputSchema.safeParse(rawInput);
  const moneyError = (value: string) => {
    if (!value.trim()) return undefined;
    const minor = moneyInput(value);
    return minor === null ||
      !Number.isSafeInteger(minor) ||
      minor > 10_000_000_000_000
      ? "Enter a USD amount with up to two decimal places."
      : undefined;
  };
  const dateError =
    draft.value.trim() && !draft.valueDate
      ? "Add the date this estimate applies to."
      : draft.valueDate > today()
        ? "Use today or an earlier valuation date."
        : undefined;
  const investmentDateError =
    draft.investmentDate > today()
      ? "Use today or an earlier investment date."
      : undefined;
  const unmatchedDate = !draft.value.trim() && Boolean(draft.valueDate);
  const unchanged =
    holding &&
    draft.name.trim() === holding.positionName &&
    draft.kind === holding.positionKind &&
    draft.owner === `container:${holding.manualContext?.containerId}` &&
    draft.company === initialDraft(holding).company;
  const ready =
    !reloadingChoices &&
    loadError === null &&
    parsed.success &&
    !moneyError(draft.cash) &&
    !moneyError(draft.value) &&
    !dateError &&
    !investmentDateError &&
    !unmatchedDate &&
    !unchanged &&
    state.kind !== "stale" &&
    !locked;
  const openReceipt = async (receipt: ManualHoldingReceipt) => {
    persistDraft(false, receipt);
    lock.current?.(false);
    try {
      await onSaved(receipt);
      clearDraft();
    } catch {
      setState({
        kind: "saved",
        receipt,
        message:
          "The holding was saved, but its details could not be loaded. Open the saved holding to try again.",
      });
    }
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || !parsed.success) return;
    setState({ kind: "saving" });
    persistDraft(true);
    lock.current?.(true);
    try {
      const response = await request(
        holding
          ? `/api/manual-holdings/${encodeURIComponent(holding.id)}/identity`
          : "/api/manual-holdings",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!response.ok) {
        const body = ErrorResponseSchema.safeParse(await response.json());
        const message = body.success ? body.data.error : undefined;
        if (body.success && body.data.code === "stale") {
          if (holding) {
            setState({
              kind: "stale",
              message:
                "This holding changed while you were editing. Cancel and reopen holding details to review the latest record before editing again.",
            });
          } else {
            onReloadOptions();
            setState({
              kind: "rejected",
              message:
                message ??
                "An owner or company changed. Review the refreshed choices before trying again.",
            });
          }
        } else if (response.status >= 500 || response.status === 409)
          setState({
            kind: "unconfirmed",
            message:
              message ??
              "Keel could not confirm the save. Check for this holding before trying again.",
          });
        else
          setState({
            kind: "rejected",
            message:
              message ??
              "The holding was not saved. Check the fields and try again.",
          });
        return;
      }
      const receipt = ManualHoldingReceiptSchema.parse(await response.json());
      setState({
        kind: "saved",
        receipt,
        message: "Opening the saved holding…",
      });
      await openReceipt(receipt);
    } catch (error) {
      setState({
        kind: "unconfirmed",
        message:
          error instanceof Error
            ? error.message
            : "Keel could not confirm the save. Check for this holding before trying again.",
      });
    }
  };
  const check = async () => {
    setState({ kind: "checking" });
    try {
      const response = await request(
        `/api/manual-holdings/submissions/${encodeURIComponent(submissionId)}`,
        {},
      );
      if (!response.ok)
        throw new Error(
          "The saved holding could not be checked. Try checking again.",
        );
      const result = ManualHoldingSubmissionSchema.parse(await response.json());
      if (result.receipt) await openReceipt(result.receipt);
      else setState({ kind: "not_found" });
    } catch (error) {
      setState({
        kind: "unconfirmed",
        message:
          error instanceof Error
            ? error.message
            : "The saved holding could not be checked. Try checking again.",
      });
    }
  };
  const ownerChoices = [
    { value: "new", label: "Add an owner or account…" },
    ...(options?.containers.map((item) => ({
      value: `container:${item.id}`,
      label: item.label,
    })) ?? []),
    ...(options?.legalEntities.map((item) => ({
      value: `entity:${item.id}`,
      label: item.label,
    })) ?? []),
  ];
  const companyChoices = [
    ...(holding &&
    !holding.companyId &&
    holding.manualContext?.companyMappingIds.length
      ? [{ value: "unchanged", label: "Keep current company groupings" }]
      : []),
    { value: "unassigned", label: "Leave unassigned" },
    ...(options?.companies.map((item) => ({
      value: `company:${item.id}`,
      label: item.name,
    })) ?? []),
  ];
  const selectField = (
    key: "owner" | "company" | "carry",
    label: string,
    choices: readonly { value: string; label: string }[],
    description?: string,
  ) => (
    <Field label={label} description={description} variant="filled">
      {key !== "carry" ? (
        <SearchSelect
          label={label}
          searchLabel={
            key === "owner" ? "Search owners and accounts" : "Search companies"
          }
          placeholder={
            key === "owner" ? "Choose owner or account" : "Leave unassigned"
          }
          emptyMessage={
            key === "owner"
              ? "No matching owners or accounts."
              : "No matching companies."
          }
          items={choices}
          value={draft[key]}
          onChange={(value) => update(key, value)}
          disabled={locked}
        />
      ) : (
        (control) => (
          <Select
            items={choices}
            value={draft[key] || null}
            onValueChange={(value) =>
              update(key, typeof value === "string" ? value : "")
            }
            disabled={locked}
          >
            <SelectTrigger {...control}>
              <SelectValue placeholder="Choose owner or account" />
            </SelectTrigger>
            <SelectContent>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      )}
    </Field>
  );
  return (
    <section
      className="manual-holding-workspace"
      aria-label={holding ? "Edit holding details" : "Add holding"}
    >
      <TextLink
        className="manual-holding-back"
        onClick={close}
        disabled={locked}
      >
        Back to {holding ? "holding" : "holdings"}
      </TextLink>
      <PageHeader
        eyebrow="Holdings"
        title={holding ? "Edit holding details" : "Add holding"}
        description={
          holding
            ? `${holding.positionName} · ${holding.ownerLabel}`
            : "Record an investment you own. Add amounts when you know them."
        }
      />
      {loadError ? (
        <div>
          <FormMessage tone="error">{loadError}</FormMessage>
          <Button onClick={onReloadOptions} disabled={busy}>
            Reload choices
          </Button>
        </div>
      ) : reloadingChoices ? (
        <LoadingStatus>Loading owner and company choices…</LoadingStatus>
      ) : null}
      <form
        className="manual-holding-form"
        aria-label={holding ? "Edit holding details" : "Add holding"}
        aria-busy={busy}
        noValidate
        onSubmit={(event) => void save(event)}
      >
        <div className="manual-holding-fields">
          <Field
            className="manual-holding-wide"
            label={
              draft.kind === "spv_interest"
                ? "SPV legal name"
                : draft.kind === "fund_interest"
                  ? "Fund name"
                  : "Investment name"
            }
            variant="filled"
          >
            {(control) => (
              <Input
                {...control}
                ref={heading}
                value={draft.name}
                maxLength={1_000}
                onChange={(event) => update("name", event.currentTarget.value)}
                disabled={locked}
                autoComplete="off"
              />
            )}
          </Field>
          <RadioGroup
            className="manual-holding-wide"
            label="Investment type"
            name="manual-holding-kind"
            value={draft.kind}
            onValueChange={(value) => update("kind", value)}
            options={[
              { value: "direct", label: "Direct" },
              { value: "spv_interest", label: "SPV" },
              { value: "fund_interest", label: "Fund" },
            ]}
            disabled={locked}
          />
          {selectField(
            "owner",
            "Held by",
            ownerChoices,
            "The person, entity or account that owns this investment.",
          )}
          {selectField(
            "company",
            "Company · optional",
            companyChoices,
            draft.kind === "fund_interest"
              ? "An underlying company. Fund allocation stays unknown."
              : "Company grouping keeps legal investments separate.",
          )}
          {draft.owner === "new" && (
            <Field
              className="manual-holding-wide"
              label="Owner or account name"
              variant="filled"
            >
              {(control) => (
                <Input
                  {...control}
                  value={draft.ownerLabel}
                  maxLength={512}
                  onChange={(event) =>
                    update("ownerLabel", event.currentTarget.value)
                  }
                  disabled={locked}
                  autoComplete="off"
                />
              )}
            </Field>
          )}
        </div>
        {!holding && (
          <Collapsible
            className="manual-holding-financial"
            open={detailsOpen}
            onOpenChange={setDetailsOpen}
            disabled={locked}
          >
            <CollapsibleTrigger layout="inline">
              {detailsOpen
                ? "Investment and valuation"
                : "Add investment or valuation details"}
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <section
                className="manual-holding-section"
                aria-labelledby="manual-investment-title"
              >
                <h2 id="manual-investment-title">Investment</h2>
                <div className="manual-holding-fields">
                  <Field
                    label="Cash paid · USD"
                    description="Cash you contributed. Keep fees and commitments separate."
                    error={moneyError(draft.cash)}
                    variant="filled"
                  >
                    {(control) => (
                      <Input
                        {...control}
                        inputMode="decimal"
                        value={draft.cash}
                        placeholder="Optional"
                        onChange={(event) =>
                          update("cash", event.currentTarget.value)
                        }
                        disabled={locked}
                      />
                    )}
                  </Field>
                  <Field
                    label="Investment date"
                    description="Leave blank if unknown."
                    error={investmentDateError}
                    variant="filled"
                  >
                    {(control) => (
                      <DatePicker
                        {...control}
                        aria-label="Investment date"
                        value={draft.investmentDate}
                        max={today()}
                        onValueChange={(value) =>
                          update("investmentDate", value)
                        }
                        disabled={locked}
                      />
                    )}
                  </Field>
                </div>
              </section>
              <section
                className="manual-holding-section"
                aria-labelledby="manual-valuation-title"
              >
                <h2 id="manual-valuation-title">Your valuation</h2>
                <p className="holding-metadata">
                  An estimate for your holding. Cash paid is not its current
                  value.
                </p>
                <div className="manual-holding-fields">
                  <Field
                    label="Estimated value · USD"
                    error={
                      moneyError(draft.value) ??
                      (unmatchedDate
                        ? "Enter an estimate or clear its date."
                        : undefined)
                    }
                    variant="filled"
                  >
                    {(control) => (
                      <Input
                        {...control}
                        inputMode="decimal"
                        value={draft.value}
                        placeholder="Optional"
                        onChange={(event) =>
                          update("value", event.currentTarget.value)
                        }
                        disabled={locked}
                      />
                    )}
                  </Field>
                  <Field
                    label="Valuation date"
                    description={
                      draft.value ? "Required for your estimate." : undefined
                    }
                    error={dateError}
                    variant="filled"
                  >
                    {(control) => (
                      <DatePicker
                        {...control}
                        aria-label="Valuation date"
                        value={draft.valueDate}
                        max={today()}
                        onValueChange={(value) => update("valueDate", value)}
                        disabled={locked}
                      />
                    )}
                  </Field>
                  {draft.kind !== "direct" && draft.value.trim() && (
                    <div className="manual-holding-wide">
                      {selectField(
                        "carry",
                        "Carry treatment",
                        [
                          { value: "unknown", label: "Not specified" },
                          { value: "before_carry", label: "Before carry" },
                          { value: "after_carry", label: "After carry" },
                        ],
                        "Choose only if you know how carry is treated.",
                      )}
                    </div>
                  )}
                </div>
              </section>
            </CollapsibleContent>
          </Collapsible>
        )}
        <ActionGroup className="manual-holding-actions">
          {state.kind === "saved" ? (
            <Button
              tone="primary"
              onClick={() => void openReceipt(state.receipt)}
            >
              Open saved holding
            </Button>
          ) : (
            <Button type="submit" tone="primary" disabled={!ready}>
              {state.kind === "saving" ? (
                <>
                  <Spinner />
                  Saving…
                </>
              ) : state.kind === "rejected" || state.kind === "not_found" ? (
                "Try again"
              ) : holding ? (
                "Save changes"
              ) : (
                "Save holding"
              )}
            </Button>
          )}
          {state.kind === "unconfirmed" || state.kind === "checking" ? (
            <Button disabled={busy} onClick={() => void check()}>
              {state.kind === "checking" ? (
                <>
                  <Spinner />
                  Checking…
                </>
              ) : (
                "Check holdings"
              )}
            </Button>
          ) : (
            state.kind !== "saved" && (
              <Button tone="quiet" disabled={locked} onClick={close}>
                Cancel
              </Button>
            )
          )}
        </ActionGroup>
        {(state.kind === "unconfirmed" ||
          state.kind === "stale" ||
          state.kind === "rejected" ||
          state.kind === "saved") && (
          <FormMessage tone={state.kind === "saved" ? "neutral" : "error"}>
            {state.message}
          </FormMessage>
        )}
        {state.kind === "not_found" && (
          <FormMessage>
            No matching holding was found. Review this entry before trying
            again.
          </FormMessage>
        )}
      </form>
    </section>
  );
}
