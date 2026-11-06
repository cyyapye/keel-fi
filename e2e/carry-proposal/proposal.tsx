import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DatePicker,
  DisclosureIndicator,
  Field,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
} from "@keel/ui";
import {
  calculate,
  cents,
  clone,
  date,
  facts,
  invalid,
  money,
  ordinary,
  type Distribution,
  type Draft,
  type Editor,
  type Receipt,
  type Source,
} from "./model";
import "./proposal.css";

type Option = { value: string; label: string };
const scenarios: Option[] = [
  { value: "ordinary", label: "Ordinary · stock distribution" },
  { value: "multiple", label: "Multiple distributions · long labels" },
  { value: "editing", label: "Edit the stock distribution" },
  { value: "cash", label: "Cash distribution" },
  { value: "excluded", label: "Provider excludes this distribution" },
  { value: "empty", label: "No distributions · confirmed complete" },
  { value: "incomplete", label: "Historical stock value unknown" },
  { value: "invalid", label: "Incomplete new distribution" },
  { value: "partial", label: "Partial distribution history" },
  { value: "prior-unknown", label: "Carry already charged unknown" },
  { value: "prior-paid", label: "Carry already charged · known $1,000" },
  { value: "provider-unknown", label: "Provider inclusion unknown" },
  { value: "provider-mixed", label: "Mixed provider inclusion · unsupported" },
  { value: "source-unknown", label: "Source carry treatment unknown" },
  { value: "source-after", label: "Source already reports after carry" },
  { value: "saving", label: "Saving · held for inspection" },
  { value: "failed", label: "Failed save · draft retained" },
  { value: "saved", label: "Saved readback" },
  { value: "later-edit", label: "Later edit · previous receipt preserved" },
  { value: "removed", label: "Removed distribution · history preserved" },
];
const inclusionOptions: Option[] = [
  { value: "included", label: "Already included" },
  { value: "excluded", label: "Not included" },
  { value: "unknown", label: "Unknown" },
  { value: "mixed", label: "Mixed · only some included" },
];
const coverageOptions: Option[] = [
  { value: "complete", label: "All received distributions recorded" },
  { value: "partial", label: "Only some distributions recorded" },
  { value: "unknown", label: "Completeness unknown" },
];

function Pick({
  label,
  value,
  options,
  onChange,
  description,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  description?: ReactNode;
}) {
  return (
    <Field label={label} description={description} variant="filled">
      {(control) => (
        <Select
          items={options}
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") onChange(next);
          }}
        >
          <SelectTrigger {...control}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}
function Entry({
  label,
  value,
  onChange,
  numeric = false,
  error,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  error?: string | undefined;
  description?: ReactNode;
}) {
  return (
    <Field
      label={label}
      variant="filled"
      error={error}
      description={description}
    >
      {(control) => (
        <Input
          {...control}
          value={value}
          inputMode={numeric ? "decimal" : "text"}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
function Calendar({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: ReactNode;
}) {
  return (
    <Field
      label={label}
      variant="filled"
      error={value ? undefined : "Choose a date."}
      description={description}
    >
      <DatePicker aria-label={label} value={value} onValueChange={onChange} />
    </Field>
  );
}

function initialReceipt(snapshot: Draft): Receipt {
  return {
    id: "demo-receipt-1",
    recordedAt: "2026-10-01T17:00:00Z",
    label: "Distribution history recorded",
    snapshot: clone(snapshot),
  };
}
function scenarioState(name: string) {
  const saved = clone(ordinary);
  const source: Source = {
    carry: "before_carry",
    reportedDistributions: 900_000n,
  };
  let editor: Editor = { phase: "closed" };
  let receipts: Receipt[] = [initialReceipt(saved)];
  if (name === "cash")
    saved.events = [
      {
        id: "demo-cash-1",
        kind: "cash",
        receivedOn: "2026-06-01",
        amount: "9000",
        evidence: "Demo cash distribution notice",
      },
    ];
  if (name === "multiple") {
    const event = saved.events[0]!;
    if (event.kind === "stock") {
      event.security =
        "Demo long-name orbital communications company common stock";
      event.amount = "6000";
      event.evidence =
        "Demo advisor statement and dated stock distribution notice";
    }
    saved.events.push({
      id: "demo-cash-2",
      kind: "cash",
      receivedOn: "2026-08-12",
      amount: "3000",
      evidence: "Demo cash distribution statement",
    });
  }
  if (name === "excluded") {
    saved.providerInclusion = "excluded";
    source.reportedDistributions = 0n;
  }
  if (name === "empty") {
    saved.events = [];
    saved.providerInclusion = "excluded";
    source.reportedDistributions = 0n;
  }
  if (name === "incomplete") {
    saved.events[0]!.amount = "";
  }
  if (name === "partial") saved.coverage = "partial";
  if (name === "prior-unknown") {
    saved.priorCarryAmount = "";
  }
  if (name === "provider-unknown") saved.providerInclusion = "unknown";
  if (name === "provider-mixed") saved.providerInclusion = "mixed";
  if (name === "prior-paid") {
    saved.events[0]!.amount = "34000";
    saved.priorCarryAmount = "1000";
    source.reportedDistributions = 3_400_000n;
  }
  if (name === "source-unknown") source.carry = "unknown";
  if (name === "source-after") source.carry = "after_carry";
  if (name === "saved" || name === "later-edit" || name === "removed") {
    saved.events[0]!.evidence = "Demo corrected distribution notice";
    receipts.push({
      id: "demo-receipt-2",
      recordedAt: "2026-10-02T17:10:00Z",
      label: "Distribution evidence updated",
      snapshot: clone(saved),
    });
  } else receipts = [initialReceipt(saved)];
  if (name === "multiple")
    receipts[0]!.label =
      "Distribution history recorded from corrected Demo stock and cash distribution statements";
  if (name === "removed") {
    saved.events = [];
    saved.providerInclusion = "excluded";
    source.reportedDistributions = 0n;
    receipts.push({
      id: "demo-receipt-3",
      recordedAt: "2026-10-03T17:20:00Z",
      label: "Distribution removed",
      snapshot: clone(saved),
    });
  }
  if (["editing", "invalid", "saving", "failed", "later-edit"].includes(name)) {
    const draft = clone(saved);
    if (name === "invalid")
      draft.events.push({
        id: "demo-new-1",
        kind: "cash",
        receivedOn: "",
        amount: "",
        evidence: "",
      });
    if (name === "saving" || name === "failed")
      draft.events[0]!.evidence = "Demo corrected distribution notice";
    editor = {
      phase:
        name === "saving" ? "saving" : name === "failed" ? "failed" : "editing",
      draft,
    };
  }
  return { saved, source, editor, receipts };
}

function eventDescription(event: Distribution) {
  return event.kind === "stock"
    ? `${event.quantity ? `${event.quantity} ` : ""}${event.security || "Stock distribution"}`
    : "Cash distribution";
}
function snapshotFacts(draft: Draft): Map<string, string> {
  const result = new Map<string, string>();
  for (const event of draft.events) {
    result.set(`${event.id} · Distribution`, eventDescription(event));
    result.set(`${event.id} · Received`, date(event.receivedOn));
    result.set(
      `${event.id} · Historical value`,
      cents(event.amount) !== null ? money(cents(event.amount)!) : "Unknown",
    );
    result.set(`${event.id} · Evidence`, event.evidence);
  }
  result.set(
    "History coverage",
    `${coverageOptions.find((option) => option.value === draft.coverage)!.label}${draft.throughDate ? ` through ${date(draft.throughDate)}` : ""}`,
  );
  result.set(
    "Carry already charged",
    cents(draft.priorCarryAmount) !== null
      ? money(cents(draft.priorCarryAmount)!)
      : "Unknown",
  );
  result.set(
    "Provider distribution inclusion",
    inclusionOptions.find((option) => option.value === draft.providerInclusion)!
      .label,
  );
  return result;
}

function ResultLimits({
  result,
  sourceCarry,
}: {
  result: ReturnType<typeof calculate>;
  sourceCarry: Source["carry"];
}) {
  const sharedCause = result.carryReason === result.returnReason;
  return (
    <>
      {result.after === null && result.carryReason && (
        <p className="result-limit">
          No after-carry estimate{sharedCause ? " or total return" : ""}.{" "}
          {result.carryReason}
          {sourceCarry !== "unknown" && " Review distributions in Investment."}
        </p>
      )}
      {result.returnReason && !sharedCause && (
        <p className="result-limit">{result.returnReason}</p>
      )}
    </>
  );
}

function App() {
  const starting = scenarioState("ordinary");
  const [scenario, setScenario] = useState("ordinary");
  const [saved, setSaved] = useState(starting.saved);
  const [source, setSource] = useState(starting.source);
  const [editor, setEditor] = useState<Editor>(starting.editor);
  const [receipts, setReceipts] = useState(starting.receipts);
  const [saveBehavior, setSaveBehavior] = useState("success");
  const editButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const id = useRef(10);
  const saving = editor.phase === "saving";
  const editing = editor.phase !== "closed";
  const current = calculate(saved, source);
  const draft = editor.phase === "closed" ? null : editor.draft;
  const preview = draft ? calculate(draft, source) : null;
  const validation = draft ? (preview?.inputError ?? invalid(draft)) : null;
  const changed =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(saved);

  useLayoutEffect(() => {
    if (editing)
      document
        .querySelector<HTMLElement>(
          '#distribution-editor [role="combobox"], #distribution-editor input',
        )
        ?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  function applyScenario(next: string) {
    const state = scenarioState(next);
    setScenario(next);
    setSaved(state.saved);
    setSource(state.source);
    setEditor(state.editor);
    setReceipts(state.receipts);
    setSaveBehavior(next === "saving" ? "hold" : "success");
  }
  function update(next: Draft) {
    setEditor({ phase: "editing", draft: next });
  }
  function updateEvent(eventId: string, next: Distribution) {
    if (draft)
      update({
        ...draft,
        events: draft.events.map((event) =>
          event.id === eventId ? next : event,
        ),
      });
  }
  function close() {
    restoreFocus.current = editing;
    setEditor({ phase: "closed" });
  }
  function finishSave(pending: Draft) {
    setSaved(clone(pending));
    const previousIds = saved.events.map((event) => event.id);
    const label =
      pending.events.length < saved.events.length
        ? "Distribution removed"
        : pending.events.some((event) => !previousIds.includes(event.id))
          ? "Distribution added"
          : "Distribution history updated";
    setReceipts((previous) => [
      ...previous,
      {
        id: `demo-receipt-${id.current++}`,
        recordedAt: new Date().toISOString(),
        label,
        snapshot: clone(pending),
      },
    ]);
    close();
  }
  function save() {
    if (!draft || !changed || validation || saving) return;
    const pending = clone(draft);
    setEditor({ phase: "saving", draft: pending });
    if (saveBehavior === "hold") return;
    window.setTimeout(() => {
      if (saveBehavior === "reject") {
        setEditor({ phase: "failed", draft: pending });
        setSaveBehavior("success");
      } else finishSave(pending);
    }, 650);
  }

  return (
    <>
      <header className="proposal-banner">
        <strong>Synthetic proposal v5</strong>
        <span>
          Distribution entry and carry. Demo sources only. Design approval
          pending.
        </span>
      </header>
      <aside className="prototype-controls" aria-label="Prototype controls">
        <Collapsible defaultOpen>
          <CollapsibleTrigger layout="inline">
            Prototype controls · outside the product <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="prototype-options">
              <Pick
                label="Preview scenario"
                value={scenario}
                options={scenarios}
                onChange={applyScenario}
              />
              <Pick
                label="Next save"
                value={saveBehavior}
                onChange={setSaveBehavior}
                options={[
                  { value: "success", label: "Succeed" },
                  { value: "reject", label: "Fail once" },
                  { value: "hold", label: "Hold in saving state" },
                ]}
              />
              <ActionGroup wrap>
                <Button
                  disabled={saving}
                  onClick={() => applyScenario(scenario)}
                >
                  Reset scenario
                </Button>
                <Button disabled={saving} onClick={close}>
                  Read saved preview
                </Button>
                {saving && (
                  <Button
                    onClick={() => {
                      if (draft) finishSave(draft);
                    }}
                  >
                    Complete held save
                  </Button>
                )}
              </ActionGroup>
            </div>
            <p className="holding-metadata">
              Saves update this preview's memory. Refresh starts the ordinary
              scenario again. Source carry treatment and provider totals change
              only when selecting a scenario.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </aside>

      <main id="simulated-product" className="proposal-product">
        <div className="proposal-topbar">
          Keel <span>/ Holdings</span>
        </div>
        <article className="spv-holding" aria-label="Demo holding">
          <header className="holding-detail-heading">
            <p className="eyebrow">Holdings</p>
            <h1>Demo company</h1>
            <p className="holding-metadata">Demo SPV I · Demo household</p>
          </header>
          {editing && <p className="eyebrow saved-values">Saved values</p>}
          <section
            aria-label="Position summary"
            className="holding-value-summary"
          >
            <div
              className="holding-value-metric"
              role="group"
              aria-label="Reported remaining value"
            >
              <p>
                Reported remaining value ·{" "}
                {source.carry === "unknown"
                  ? "Carry unspecified"
                  : source.carry === "after_carry"
                    ? "After carry"
                    : "Before carry"}
              </p>
              <strong className="holding-value-amount">
                {money(facts.remaining)}
              </strong>
              {current.beforeReturn && (
                <strong className="holding-value-return">
                  {current.beforeReturn}
                  <small>Total return · Before remaining carry</small>
                </strong>
              )}
              {source.carry === "after_carry" && current.afterReturn && (
                <strong className="holding-value-return">
                  {current.afterReturn}
                  <small>Total return · After carry</small>
                </strong>
              )}
              <p className="holding-metadata">
                {date(facts.asOf)} · Demo SPV statement
              </p>
            </div>
            {current.after !== null && source.carry === "before_carry" && (
              <div
                className="holding-value-metric"
                role="group"
                aria-label="Estimated remaining value after carry"
              >
                <p>Estimated remaining value · After carry</p>
                <strong className="holding-value-amount">
                  {money(current.after)}
                </strong>
                {current.afterReturn && (
                  <strong className="holding-value-return">
                    {current.afterReturn}
                    <small>Total return · After carry</small>
                  </strong>
                )}
                <p className="holding-metadata">
                  {date(facts.asOf)} · Estimate
                </p>
              </div>
            )}
            <div
              className="holding-value-metric"
              role="group"
              aria-label="Net invested"
            >
              <p>Net invested</p>
              <strong className="holding-value-amount">
                {money(facts.netInvested)}
              </strong>
              <p className="holding-metadata">Return denominator</p>
            </div>
          </section>
          <ResultLimits result={current} sourceCarry={source.carry} />
          <Collapsible className="holding-calculation">
            <CollapsibleTrigger layout="inline">
              Return calculation <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <DataList layout="rows">
                <DataItem
                  label="Provider-reported distributions"
                  value={money(source.reportedDistributions)}
                />
                <DataItem
                  label="Recorded distributions in provider total"
                  value={
                    inclusionOptions.find(
                      (option) => option.value === saved.providerInclusion,
                    )!.label
                  }
                />
                {current.received !== null && !current.returnReason && (
                  <DataItem
                    label="Distributions used in total return"
                    value={money(current.received)}
                  />
                )}
              </DataList>
              <p className="holding-metadata">
                Total return = (remaining value + investor distributions − net
                invested) ÷ net invested. Before remaining carry uses the
                reported remaining value; after carry uses the remaining value
                after any additional carry. Historical investor distributions
                are already after advisor carry and enter once at their fixed
                received-date value. Prior carry is not added back to investor
                return.
              </p>
            </CollapsibleContent>
          </Collapsible>

          <section
            className="holding-investment"
            aria-labelledby="investment-title"
          >
            <div className="holding-section-heading">
              <h2 id="investment-title">Investment</h2>
            </div>
            <DataList layout="rows">
              <DataItem label="Cash paid" value={money(facts.capital)} />
              <DataItem label="Paid upfront fees" value={money(facts.fees)} />
              <DataItem
                label="Carry"
                value={
                  <>
                    20%<small>After contributed capital is returned</small>
                  </>
                }
              />
            </DataList>

            <div className="distribution-heading holding-section-heading">
              <h3>Received distributions</h3>
              {!editing && (
                <Button
                  ref={editButton}
                  tone="quiet"
                  onClick={() => {
                    setEditor({ phase: "editing", draft: clone(saved) });
                  }}
                >
                  Edit distributions
                </Button>
              )}
            </div>
            {draft ? (
              <form
                id="distribution-editor"
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  save();
                }}
              >
                <fieldset disabled={saving} className="holding-form-fieldset">
                  {draft.events.map((event, index) => (
                    <section
                      className="distribution-event"
                      aria-label={`Distribution ${index + 1}`}
                      key={event.id}
                    >
                      <div className="event-heading">
                        {draft.events.length > 1 && (
                          <h4>Distribution {index + 1}</h4>
                        )}
                        <Button
                          tone="quiet"
                          aria-label={`Remove distribution ${index + 1}`}
                          onClick={() =>
                            update({
                              ...draft,
                              events: draft.events.filter(
                                (item) => item.id !== event.id,
                              ),
                            })
                          }
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="holding-fields">
                        <Pick
                          label="Received as"
                          value={event.kind}
                          options={[
                            { value: "cash", label: "Cash" },
                            { value: "stock", label: "Stock" },
                          ]}
                          onChange={(kind) => {
                            const common = {
                              id: event.id,
                              receivedOn: event.receivedOn,
                              amount: event.amount,
                              evidence: event.evidence,
                            };
                            updateEvent(
                              event.id,
                              kind === "cash"
                                ? { ...common, kind: "cash" }
                                : {
                                    ...common,
                                    kind: "stock",
                                    security: "",
                                    quantity: "",
                                  },
                            );
                          }}
                        />
                        <Calendar
                          label="Received on"
                          value={event.receivedOn}
                          onChange={(receivedOn) =>
                            updateEvent(event.id, { ...event, receivedOn })
                          }
                        />
                        {event.kind === "stock" && (
                          <>
                            <Entry
                              label="Security received"
                              value={event.security}
                              description="Optional when the security is unknown."
                              onChange={(security) =>
                                updateEvent(event.id, { ...event, security })
                              }
                            />
                            <Entry
                              label="Shares received"
                              value={event.quantity}
                              numeric
                              description="Optional when the quantity is unknown."
                              onChange={(quantity) =>
                                updateEvent(event.id, { ...event, quantity })
                              }
                            />
                          </>
                        )}
                        <Entry
                          label={
                            event.kind === "stock"
                              ? "Historical value · $"
                              : "Cash received · $"
                          }
                          value={event.amount}
                          numeric
                          description="After advisor carry. Leave blank if unknown."
                          error={
                            event.amount.trim() && cents(event.amount) === null
                              ? "Enter a nonnegative amount with up to two decimal places."
                              : undefined
                          }
                          onChange={(amount) =>
                            updateEvent(event.id, { ...event, amount })
                          }
                        />
                        <Entry
                          label="Evidence"
                          value={event.evidence}
                          error={
                            event.evidence.trim()
                              ? undefined
                              : "Name the notice or other evidence."
                          }
                          onChange={(evidence) =>
                            updateEvent(event.id, { ...event, evidence })
                          }
                        />
                      </div>
                      {event.kind === "stock" && (
                        <p className="holding-metadata">
                          Record the historical value on the received date.
                          Today's stock price does not change this distribution.
                        </p>
                      )}
                    </section>
                  ))}
                  {draft.events.length === 0 && (
                    <p>No received distributions recorded.</p>
                  )}
                  <ActionGroup>
                    <Button
                      tone="quiet"
                      onClick={() =>
                        update({
                          ...draft,
                          events: [
                            ...draft.events,
                            {
                              id: `demo-new-${id.current++}`,
                              kind: "cash",
                              receivedOn: "",
                              amount: "",
                              evidence: "",
                            },
                          ],
                        })
                      }
                    >
                      Add distribution
                    </Button>
                  </ActionGroup>

                  <div className="coverage-fields holding-fields">
                    <Pick
                      label="Distribution history"
                      value={draft.coverage}
                      options={coverageOptions}
                      onChange={(coverage) =>
                        update({
                          ...draft,
                          coverage: coverage as Draft["coverage"],
                        })
                      }
                    />
                    <Calendar
                      label="History through"
                      value={draft.throughDate}
                      description="Actual date reviewed, even when completeness is unknown."
                      onChange={(throughDate) =>
                        update({ ...draft, throughDate })
                      }
                    />
                    <Entry
                      label="Carry already charged · $"
                      value={draft.priorCarryAmount}
                      numeric
                      description="Leave blank if unknown. Enter 0 only when confirmed."
                      error={
                        draft.priorCarryAmount.trim() &&
                        cents(draft.priorCarryAmount) === null
                          ? "Enter a nonnegative amount with up to two decimal places."
                          : undefined
                      }
                      onChange={(priorCarryAmount) =>
                        update({ ...draft, priorCarryAmount })
                      }
                    />
                    <Pick
                      label="Recorded distributions in provider total"
                      value={draft.providerInclusion}
                      options={inclusionOptions}
                      onChange={(providerInclusion) =>
                        update({
                          ...draft,
                          providerInclusion:
                            providerInclusion as Draft["providerInclusion"],
                        })
                      }
                      description={`Provider-reported distributions: ${money(source.reportedDistributions)}.`}
                    />
                  </div>
                  <p className="holding-metadata">
                    Inclusion determines whether recorded distributions add to
                    the provider total for return calculations. It does not
                    change the contributed-capital hurdle for carry.
                  </p>
                  <div className="distribution-preview" aria-live="polite">
                    <h4>Proposed effect</h4>
                    {preview?.inputError ? (
                      <p>
                        Complete the required inputs to preview these edits.
                      </p>
                    ) : preview?.after !== null &&
                      preview?.after !== undefined ? (
                      <div className="distribution-preview-values">
                        <div>
                          <p className="holding-metadata">
                            {source.carry === "after_carry"
                              ? "Reported remaining value · After carry"
                              : "Estimated remaining value · After carry"}
                          </p>
                          <strong className="distribution-preview-amount">
                            {money(preview.after)}
                          </strong>
                        </div>
                        {preview.carry !== null && (
                          <div>
                            <p className="holding-metadata">
                              Estimated remaining carry
                            </p>
                            <strong className="distribution-preview-carry">
                              {money(preview.carry)}
                            </strong>
                          </div>
                        )}
                      </div>
                    ) : null}
                    {preview && !preview.inputError && (
                      <ResultLimits
                        result={preview}
                        sourceCarry={source.carry}
                      />
                    )}
                  </div>
                  {validation && (
                    <FormMessage tone="error">{validation}</FormMessage>
                  )}
                  {editor.phase === "failed" && (
                    <FormMessage tone="error">
                      Distributions could not be saved. Try again.
                    </FormMessage>
                  )}
                  <ActionGroup wrap>
                    <Button
                      type="submit"
                      tone="primary"
                      disabled={!changed || Boolean(validation) || saving}
                    >
                      {saving && <Spinner />}
                      {saving
                        ? "Saving…"
                        : editor.phase === "failed"
                          ? "Retry save"
                          : "Save distributions"}
                    </Button>
                    <Button tone="quiet" disabled={saving} onClick={close}>
                      Cancel
                    </Button>
                  </ActionGroup>
                </fieldset>
              </form>
            ) : (
              <>
                {saved.events.map((event) => (
                  <article className="distribution-summary" key={event.id}>
                    <div className="distribution-summary-line">
                      <div className="distribution-identity">
                        <h4>{eventDescription(event)}</h4>
                        <p className="holding-metadata">
                          Received {date(event.receivedOn)}
                        </p>
                      </div>
                      <div className="distribution-amount">
                        <strong>
                          {cents(event.amount) !== null
                            ? money(cents(event.amount)!)
                            : "Unknown"}
                        </strong>
                        <p className="holding-metadata">
                          {event.kind === "stock"
                            ? "Historical value"
                            : "Cash received"}
                          {cents(event.amount) === null ? " unknown" : ""}
                        </p>
                      </div>
                    </div>
                    <p className="holding-metadata">{event.evidence}</p>
                  </article>
                ))}
                {saved.events.length > 0 && (
                  <p className="holding-metadata distribution-basis">
                    Values are historical amounts on the received date, credited
                    to the investor after advisor carry.
                  </p>
                )}
                {saved.events.length === 0 && (
                  <p>No received distributions recorded.</p>
                )}
                <p className="holding-metadata">
                  {saved.coverage === "complete"
                    ? "All received distributions recorded"
                    : saved.coverage === "partial"
                      ? "Partial distribution history"
                      : "Distribution history completeness unknown"}
                  {saved.throughDate
                    ? ` through ${date(saved.throughDate)}`
                    : ""}
                  .
                </p>
                <Collapsible className="carry-details">
                  <CollapsibleTrigger layout="inline">
                    Carry details <DisclosureIndicator />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <DataList layout="rows">
                      <DataItem
                        label="Contributed-capital hurdle"
                        value={money(facts.capital)}
                      />
                      {current.received !== null && (
                        <DataItem
                          label="Received distributions at historical value"
                          value={money(current.received)}
                        />
                      )}
                      {current.unreturned !== null && (
                        <DataItem
                          label="Capital still to return"
                          value={money(current.unreturned)}
                        />
                      )}
                      <DataItem
                        label="Carry already charged"
                        value={
                          cents(saved.priorCarryAmount) !== null
                            ? money(cents(saved.priorCarryAmount)!)
                            : "Unknown"
                        }
                      />
                      {current.carry !== null && (
                        <DataItem
                          label="Estimated remaining carry"
                          value={money(current.carry)}
                        />
                      )}
                    </DataList>
                    {current.carry !== null ? (
                      <p className="holding-metadata">
                        Only investor distributions reduce capital still to
                        return. 20% of gains above contributed capital across
                        received investor value, carry already charged and
                        remaining value, rounded once, then less carry already
                        charged. Paid upfront fees reduce net invested, and do
                        not reduce this capital hurdle.
                      </p>
                    ) : saved.priorCarryAmount.trim() ? (
                      <p className="holding-metadata">{current.carryReason}</p>
                    ) : null}
                  </CollapsibleContent>
                </Collapsible>
              </>
            )}
          </section>

          <section className="holding-history" aria-labelledby="history-title">
            <h2 id="history-title">Sources &amp; history</h2>
            <div className="holding-receipt-history">
              {[...receipts].reverse().map((receipt) => {
                const originalIndex = receipts.indexOf(receipt);
                const previous =
                  originalIndex > 0
                    ? snapshotFacts(receipts[originalIndex - 1]!.snapshot)
                    : new Map<string, string>();
                const next = snapshotFacts(receipt.snapshot);
                const keys = [
                  ...new Set([...previous.keys(), ...next.keys()]),
                ].filter((key) => previous.get(key) !== next.get(key));
                return (
                  <Collapsible key={receipt.id}>
                    <div className="holding-history-line">
                      <CollapsibleTrigger
                        layout="inline"
                        className="holding-history-entry"
                        aria-describedby={`history-time-${receipt.id}`}
                      >
                        <span>{receipt.label}</span>
                        <DisclosureIndicator />
                      </CollapsibleTrigger>
                      <time
                        id={`history-time-${receipt.id}`}
                        dateTime={receipt.recordedAt}
                      >
                        {new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(receipt.recordedAt))}
                      </time>
                    </div>
                    <CollapsibleContent>
                      <DataList layout="rows">
                        {keys.map((key) => (
                          <DataItem
                            key={key}
                            label={
                              key.includes(" · ") ? key.split(" · ")[1] : key
                            }
                            value={
                              previous.has(key)
                                ? `${previous.get(key)} → ${next.get(key) ?? "Removed"}`
                                : (next.get(key) ?? "Removed")
                            }
                          />
                        ))}
                      </DataList>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </section>
        </article>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
