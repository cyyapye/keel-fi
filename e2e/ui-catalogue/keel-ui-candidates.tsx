import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Checkbox,
  RadioGroup,
  FieldGroup,
  LoadingStatus,
  Spinner,
  CollectionFooter,
  RecordItem,
  RecordGroup,
  RecordRow,
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DisclosureIndicator,
  EmptyState,
  Field,
  FormMessage,
  Input,
  Notice,
  SectionHeader,
  TextLink,
} from "@keel/ui";

function Example({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section
      className={"catalogue-example" + (wide ? " catalogue-example--wide" : "")}
      aria-label={title}
    >
      <SectionHeader title={title} />
      <p className="catalogue-source">{description}</p>
      <div className="catalogue-example-content">{children}</div>
    </section>
  );
}
function PreviewStates({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="candidate-preview-states" role="group" aria-label={label}>
      <span>Preview state</span>
      <ActionGroup wrap>
        {values.map((v) => (
          <Button
            size="compact"
            key={v}
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {v}
          </Button>
        ))}
      </ActionGroup>
    </div>
  );
}
function AccessibleField({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string | undefined;
  children: (props: {
    id: string;
    "aria-labelledby": string;
    "aria-describedby"?: string | undefined;
    "aria-invalid"?: true | undefined;
  }) => ReactNode;
}) {
  return (
    <Field label={label} description={help} error={error} variant="filled">
      {children}
    </Field>
  );
}
export function SourceCitation({ missing = false }: { missing?: boolean }) {
  if (missing)
    return (
      <Notice>
        The source excerpt is unavailable. The recorded change is retained.
      </Notice>
    );
  return (
    <figure className="candidate-citation">
      <blockquote>
        “The name of the limited liability company is Northstar SPV I, LLC.”
      </blockquote>
      <figcaption>
        Demo formation certificate · page 1<br />
        Recorded Oct 20, 2026
      </figcaption>
    </figure>
  );
}
function useDemoDelay() {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return (callback: () => void, ms = 650) => {
    timers.current.push(setTimeout(callback, ms));
  };
}
export function CheckboxExample() {
  const [selected, setSelected] = useState(["name", "formed"]);
  const [disabled, setDisabled] = useState(false);
  const columns = [
    ["name", "Legal name"],
    ["formed", "Formation date"],
    ["notes", "Notes"],
  ];
  const toggle = (value: string, checked: boolean) =>
    setSelected((current) =>
      checked
        ? [...current.filter((x) => x !== value), value]
        : current.filter((x) => x !== value),
    );
  return (
    <Example
      title="Checkbox"
      description="Independent choices, a mixed parent selection, disabled options and validation."
    >
      <PreviewStates
        label="Checkbox preview state"
        value={disabled ? "Disabled" : "Editable"}
        values={["Editable", "Disabled"]}
        onChange={(v) => setDisabled(v === "Disabled")}
      />
      <FieldGroup label="Export columns">
        <Checkbox
          label="All available columns"
          checked={selected.length === 3}
          indeterminate={selected.length > 0 && selected.length < 3}
          onCheckedChange={(v) =>
            setSelected(v ? columns.map((c) => c[0]!) : [])
          }
          disabled={disabled}
        />
        <div className="candidate-choice-children">
          {columns.map(([value, label]) => (
            <Checkbox
              key={value}
              label={label}
              checked={selected.includes(value!)}
              onCheckedChange={(v) => toggle(value!, v)}
              disabled={disabled}
            />
          ))}
          <Checkbox
            label="Tax identifier"
            description="Unavailable in this demo source."
            checked={false}
            onCheckedChange={() => {}}
            disabled
          />
        </div>
      </FieldGroup>
      {selected.length === 0 ? (
        <FormMessage tone="error">Choose at least one column.</FormMessage>
      ) : (
        <p className="candidate-metadata" role="status">
          {selected.length} columns selected
        </p>
      )}
    </Example>
  );
}
export function RadioExample() {
  const [value, setValue] = useState("formation");
  const [disabled, setDisabled] = useState(false);
  return (
    <Example
      title="RadioGroup"
      description="Compact exclusive choices. Use ChoiceGroup when alternatives need a larger comparison."
    >
      <PreviewStates
        label="Radio preview state"
        value={disabled ? "Disabled" : "Editable"}
        values={["Editable", "Disabled"]}
        onChange={(v) => setDisabled(v === "Disabled")}
      />
      <RadioGroup
        label="Name source"
        value={value}
        onValueChange={setValue}
        disabled={disabled}
        options={[
          {
            value: "formation",
            label: "Formation certificate",
            description: "Issued May 14, 2024",
          },
          {
            value: "subscription",
            label: "Subscription agreement",
            description: "Signed June 3, 2024",
          },
          {
            value: "statement",
            label: "Quarterly statement",
            description: "No legal name supplied.",
            disabled: true,
          },
        ]}
      />
      <p className="candidate-metadata" role="status">
        {value === "formation"
          ? "Formation certificate"
          : "Subscription agreement"}{" "}
        selected
      </p>
    </Example>
  );
}
export function LoadingExample() {
  const [state, setState] = useState("Ready");
  const [fail, setFail] = useState(false);
  const later = useDemoDelay();
  const refresh = () => {
    setState("Loading");
    later(() => {
      setState(fail ? "Failed" : "Ready");
      setFail(false);
    });
  };
  return (
    <Example
      title="LoadingStatus & Spinner"
      description="Pending feedback retains the last available content; failures have a local recovery action."
    >
      <PreviewStates
        label="Loading preview state"
        value={state}
        values={["Ready", "Loading", "Failed"]}
        onChange={setState}
      />
      <RecordItem
        title="Northstar SPV I, LLC"
        detail="2 linked sources"
        metadata="Last completed check · Oct 20, 2026"
      />
      {state === "Loading" ? (
        <LoadingStatus>Refreshing sources…</LoadingStatus>
      ) : state === "Failed" ? (
        <Notice tone="error">Sources could not be refreshed.</Notice>
      ) : (
        <p className="candidate-metadata">Ready to check for updates.</p>
      )}
      <ActionGroup>
        <Button onClick={refresh} disabled={state === "Loading"}>
          {state === "Failed" ? "Retry refresh" : "Refresh sources"}
        </Button>
      </ActionGroup>
      <div className="candidate-demo-options">
        <Checkbox
          label="Fail next refresh"
          checked={fail}
          onCheckedChange={setFail}
          disabled={state === "Loading"}
        />
      </div>
    </Example>
  );
}
const records = [
  "Northstar SPV I, LLC",
  "Meridian SPV I, LLC",
  "Cedar Ventures LLC",
  "Harbor SPV I, LLC",
  "Atlas Holdings LLC",
  "Juniper SPV I, LLC",
  "Sequoia Ventures LLC",
];
// One incremental collection contract. The page chooses its loading policy.
// This synthetic preview has a finite 15-row bound; production cursors and DOM
// windowing remain application-owned and require independent scale verification.
function useCollectionDemo({
  total,
  initial = 3,
  batch = 2,
}: {
  total: number;
  initial?: number;
  batch?: number;
}) {
  const [count, setCount] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fail, setFail] = useState(true);
  const inFlight = useRef(false);
  const list = useRef<HTMLUListElement>(null);
  const focusNext = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (focusNext.current === null) return;
    list.current
      ?.querySelector<HTMLElement>(
        '[data-record-index="' + focusNext.current + '"]',
      )
      ?.focus({ preventScroll: true });
    focusNext.current = null;
  }, [count]);
  const more = useCallback(
    (manual = true) => {
      if (inFlight.current || count >= total) return;
      inFlight.current = true;
      setBusy(true);
      setError("");
      timer.current = setTimeout(() => {
        inFlight.current = false;
        setBusy(false);
        if (fail) {
          setError("More records could not be loaded.");
          setFail(false);
        } else {
          if (manual) focusNext.current = count;
          setCount((c) => Math.min(c + batch, total));
        }
      }, 650);
    },
    [count, total, batch, fail],
  );
  const reset = () => {
    if (inFlight.current) return;
    setCount(initial);
    setError("");
    setFail(true);
  };
  return { count, busy, error, fail, setFail, list, more, reset };
}
function CollectionExample({
  onShowAutomatic,
}: {
  onShowAutomatic: () => void;
}) {
  const collection = useCollectionDemo({ total: records.length });
  const [unknown, setUnknown] = useState(false);
  return (
    <Example
      title="CollectionFooter"
      description="Use Load more when another section or page footer follows the collection."
    >
      <ul className="candidate-record-list" ref={collection.list}>
        {records.slice(0, collection.count).map((name, index) => (
          <li key={name} tabIndex={-1} data-record-index={index}>
            {name}
          </li>
        ))}
      </ul>
      <CollectionFooter
        shown={collection.count}
        total={unknown ? undefined : records.length}
        hasMore={collection.count < records.length}
        busy={collection.busy}
        error={collection.error}
        onLoadMore={(source) => collection.more(source === "manual")}
      />
      <div className="candidate-demo-options">
        <Checkbox
          label="Unknown total"
          checked={unknown}
          onCheckedChange={setUnknown}
        />
        <Checkbox
          label="Fail next load"
          checked={collection.fail}
          onCheckedChange={collection.setFail}
          disabled={collection.busy}
        />
        <Button
          tone="quiet"
          disabled={collection.busy}
          onClick={collection.reset}
        >
          Reset collection
        </Button>
      </div>
      <p className="candidate-metadata">
        When the collection is the page’s main content and nothing follows it,
        load automatically as the reader approaches the end. Keep the same
        count, loading, retry and end states.
      </p>
      <TextLink onClick={onShowAutomatic}>
        Explore automatic loading & usage rules
      </TextLink>
    </Example>
  );
}
const automaticRecords = [
  ...records,
  "Willow Ventures LLC",
  "Birch SPV I, LLC",
  "Aspen Holdings LLC",
  "Redwood SPV I, LLC",
  "Oak Ventures LLC",
  "Maple SPV I, LLC",
  "Pine Holdings LLC",
  "Cypress Ventures LLC",
];
export function CollectionLoading() {
  const manualPreview = useRef<HTMLDivElement>(null);
  const automaticPreview = useRef<HTMLElement>(null);
  const [automatic, setAutomatic] = useState(true);
  const [unknown, setUnknown] = useState(false);
  const collection = useCollectionDemo({
    total: automaticRecords.length,
    initial: 5,
    batch: 5,
  });
  return (
    <div className="candidate-examples candidate-collection-page">
      <section
        className="candidate-loading-rules"
        aria-label="Collection loading rules"
      >
        <SectionHeader title="One pattern, two loading modes" />
        <div className="candidate-loading-rule-grid">
          <div>
            <h3>Automatic loading</h3>
            <p>
              Use when the collection is the main page content and nothing
              follows it. Load the next batch near the end of the visible
              records.
            </p>
          </div>
          <div>
            <h3>Load more</h3>
            <p>
              Use when another section or footer follows, or the task needs an
              explicit stopping point. Keep that content reachable.
            </p>
          </div>
        </div>
        <p className="candidate-metadata">
          Keep a keyboard-accessible Load more action in both modes. Announce
          progress and the end; pause automatic loading after a failure until
          Retry. Automatic appends must not move focus or reset scroll. A
          manually requested batch moves focus to its first new record.
        </p>
        <p className="candidate-metadata">
          Choose numbered pages only when people need stable page links or
          direct jumps. For large collections, bound requests and rendered rows;
          automatic loading must not grow the page indefinitely.
        </p>
        <TextLink
          onClick={() =>
            manualPreview.current?.scrollIntoView({ block: "start" })
          }
        >
          Compare the Load more example
        </TextLink>
      </section>
      <div ref={manualPreview}>
        <CollectionExample
          onShowAutomatic={() =>
            automaticPreview.current?.scrollIntoView({ block: "start" })
          }
        />
      </div>
      <section
        ref={automaticPreview}
        aria-label="Automatic loading preview controls"
        className="candidate-collection-controls"
      >
        <SectionHeader title="Try automatic loading" />
        <p className="candidate-metadata">
          Scroll toward the last record. The first load fails so you can inspect
          recovery. These are 15 synthetic records; no content follows this
          collection.
        </p>
        <div className="candidate-control-row">
          <Checkbox
            label="Automatic loading"
            checked={automatic}
            onCheckedChange={setAutomatic}
          />
          <Checkbox
            label="Unknown total"
            checked={unknown}
            onCheckedChange={setUnknown}
          />
          <Checkbox
            label="Fail next load"
            checked={collection.fail}
            onCheckedChange={collection.setFail}
            disabled={collection.busy}
          />
          <Button
            tone="quiet"
            onClick={collection.reset}
            disabled={collection.busy}
          >
            Reset collection
          </Button>
        </div>
      </section>
      <section
        aria-label="Automatically loaded records"
        className="candidate-automatic-collection"
      >
        <ul className="candidate-record-list" ref={collection.list}>
          {automaticRecords.slice(0, collection.count).map((name, index) => (
            <li key={name} data-record-index={index} tabIndex={-1}>
              {name}
            </li>
          ))}
        </ul>
        <div>
          <CollectionFooter
            shown={collection.count}
            total={unknown ? undefined : automaticRecords.length}
            hasMore={collection.count < automaticRecords.length}
            busy={collection.busy}
            error={collection.error}
            mode={automatic ? "automatic" : "manual"}
            onLoadMore={(source) => collection.more(source === "manual")}
          />
        </div>
      </section>
    </div>
  );
}
export function FieldSaveExample() {
  const [value, setValue] = useState("Demo formation certificate");
  const [saved, setSaved] = useState(value);
  const [state, setState] = useState("idle");
  const [fail, setFail] = useState(true);
  const later = useDemoDelay();
  const error = value.trim() === "" ? "Enter a source name." : undefined;
  const save = () => {
    if (error || value === saved) return;
    setState("saving");
    later(() => {
      if (fail) {
        setState("failed");
        setFail(false);
      } else {
        setSaved(value);
        setState("saved");
      }
    });
  };
  return (
    <Example
      title="Field, validation & pending actions"
      description="An associated description and error, with a draft-preserving save/retry recipe."
      wide
    >
      <form
        className="candidate-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <AccessibleField
          label="Source name"
          help="Use the name printed on the document."
          error={error}
        >
          {(props) => (
            <Input
              {...props}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setState("idle");
              }}
              disabled={state === "saving"}
            />
          )}
        </AccessibleField>
        <ActionGroup wrap>
          <Button
            type="submit"
            tone="primary"
            disabled={Boolean(error) || value === saved || state === "saving"}
          >
            {state === "saving" ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : state === "failed" ? (
              "Retry save"
            ) : (
              "Save source name"
            )}
          </Button>
          <Button
            tone="quiet"
            disabled={value === saved || state === "saving"}
            onClick={() => {
              setValue(saved);
              setState("idle");
            }}
          >
            Cancel
          </Button>
        </ActionGroup>
        {state === "failed" && (
          <FormMessage tone="error">
            The source name could not be saved.
          </FormMessage>
        )}
        {state === "saved" && (
          <FormMessage tone="success">
            Source name saved in this preview.
          </FormMessage>
        )}
      </form>
      <div className="candidate-demo-options">
        <Checkbox
          label="Fail next save"
          checked={fail}
          onCheckedChange={setFail}
          disabled={state === "saving"}
        />
      </div>
    </Example>
  );
}

function RecordGroupExample() {
  const [state, setState] = useState("Multiple");
  const [selected, setSelected] = useState<string | null>(null);
  const publicRows = [
    {
      name: "Fidelity brokerage",
      value: "$4,800",
      basis: "$3,600",
      performance: "+33% total return",
      detail: null,
    },
    {
      name: "Robinhood Roth IRA",
      value: "$3,200",
      basis: "$2,500",
      performance: "+28% total return",
      detail: null,
    },
    {
      name: "Robinhood brokerage",
      value: "$2,000",
      basis: "$1,500",
      performance: "+33% total return",
      detail: null,
    },
  ];
  const rows =
    state === "Single"
      ? publicRows.slice(0, 1)
      : state === "Unavailable"
        ? [
            {
              name: "Northstar Opportunity Fund I, LLC",
              value: "$20,000",
              basis: "$20,000",
              performance: null,
              detail: "Demo Family Trust",
            },
            {
              name: "Northstar Long-Term Growth SPV II, LLC",
              value: "Unavailable",
              basis: "$15,000",
              performance: null,
              detail: "Demo Retirement Trust",
            },
          ]
        : publicRows;
  return (
    <Example
      title="Alternating record rows"
      description="Alternate a light ink wash with the canvas background to distinguish related rows. The first row is shaded, including in a one-record group. Use this inside a disclosure; keep unrelated sections outside the group."
      wide
    >
      <PreviewStates
        label="Alternating rows preview"
        value={state}
        values={["Multiple", "Single", "Unavailable", "Empty"]}
        onChange={(value) => {
          setState(value);
          setSelected(null);
        }}
      />
      {state === "Empty" ? (
        <EmptyState title="No positions" compact icon={null} />
      ) : (
        <Collapsible defaultOpen key={state}>
          <CollapsibleTrigger className="catalogue-record-summary">
            <span>
              {state === "Unavailable" ? "Northstar Robotics" : "NVDA"}
              <small>
                {rows.length} {rows.length === 1 ? "position" : "positions"}
              </small>
            </span>
            <span>
              {state === "Unavailable" && <small>Known value</small>}
              {state === "Unavailable"
                ? "$20,000"
                : state === "Single"
                  ? "$4,800"
                  : "$10,000"}
              {state === "Unavailable" && <small>1 value unavailable</small>}
            </span>
            <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <RecordGroup aria-label="Example positions">
              {rows.map((row) => (
                <RecordRow
                  key={row.name}
                  title={row.name}
                  detail={row.detail}
                  value={row.value}
                  metadata={
                    <>
                      <span>Basis {row.basis}</span>
                      {row.performance && <span>{row.performance}</span>}
                    </>
                  }
                  action={
                    <TextLink
                      onClick={() => setSelected(row.name)}
                      aria-label={`Details for ${row.name}`}
                    >
                      Details
                    </TextLink>
                  }
                />
              ))}
            </RecordGroup>
            {selected && (
              <p role="status" className="catalogue-note">
                {selected} selected
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}
    </Example>
  );
}

function RecordRowsExample() {
  const [open, setOpen] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  return (
    <Example
      title="Record rows"
      description="Title, meaningful detail, optional provenance and one action per record. Long names wrap without clipping."
      wide
    >
      <PreviewStates
        label="Record list preview"
        value={empty ? "Empty" : "Records"}
        values={["Records", "Empty"]}
        onChange={(v) => setEmpty(v === "Empty")}
      />
      {empty ? (
        <EmptyState title="No matching entities" compact icon={null}>
          Try another search.
        </EmptyState>
      ) : (
        <div>
          <RecordItem
            title="Northstar SPV I, LLC"
            detail="Northstar Robotics"
            metadata="Delaware, US"
            action={
              <Button
                tone="quiet"
                aria-expanded={open === "northstar"}
                onClick={() =>
                  setOpen(open === "northstar" ? null : "northstar")
                }
              >
                {open === "northstar" ? "Close details" : "View details"}
              </Button>
            }
          >
            {open === "northstar" && (
              <div className="catalogue-fact-values">
                <p>Formed May 14, 2024</p>
                <p>EIN ending 4821</p>
              </div>
            )}
          </RecordItem>
          <RecordItem
            title="Meridian Climate Infrastructure Opportunities SPV I, LLC"
            detail="Meridian Energy"
            action={
              <Button
                aria-expanded={open === "meridian"}
                onClick={() => setOpen(open === "meridian" ? null : "meridian")}
              >
                {open === "meridian" ? "Close sources" : "Review sources"}
              </Button>
            }
          >
            <p className="candidate-attention">
              The source documents report different legal names.
            </p>
            {open === "meridian" && (
              <DataList layout="rows">
                <DataItem
                  label="Formation certificate"
                  value="Meridian Climate Infrastructure Opportunities SPV I, LLC"
                />
                <DataItem
                  label="Subscription agreement"
                  value="Meridian Climate Infrastructure SPV I, LLC"
                />
              </DataList>
            )}
          </RecordItem>
        </div>
      )}
    </Example>
  );
}
function HistoryExample() {
  const [state, setState] = useState("History");
  return (
    <Example
      title="History, changes & source citations"
      description="The closed entry identifies the change. Expansion shows changed facts and their evidence."
      wide
    >
      <PreviewStates
        label="History preview state"
        value={state}
        values={["History", "Empty", "Source unavailable"]}
        onChange={setState}
      />
      {state === "Empty" ? (
        <EmptyState title="No recorded changes yet" compact icon={null} />
      ) : (
        <div className="candidate-history">
          <Collapsible>
            <CollapsibleTrigger layout="inline">
              <span className="candidate-history-label">
                <span>Legal name corrected</span>
                <time dateTime="2026-10-20T17:30:00Z">
                  Oct 20, 2026, 10:30 AM
                </time>
              </span>
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="candidate-history-body">
                <DataList layout="rows">
                  <DataItem label="Previous" value="Northstar SPV 1, LLC" />
                  <DataItem label="Accepted" value="Northstar SPV I, LLC" />
                </DataList>
                <Collapsible>
                  <CollapsibleTrigger layout="inline">
                    Source excerpt <DisclosureIndicator />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <SourceCitation missing={state === "Source unavailable"} />
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <Collapsible>
            <CollapsibleTrigger layout="inline">
              <span className="candidate-history-label">
                <span>Entity first recorded</span>
                <time dateTime="2026-10-19T16:05:00Z">
                  Oct 19, 2026, 9:05 AM
                </time>
              </span>
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="candidate-history-body">
                <p>Formed May 14, 2024 · Delaware, US</p>
                <p className="candidate-metadata">
                  Demo subscription agreement · page 2
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      )}
    </Example>
  );
}
const importRows = [
  {
    id: "northstar",
    name: "Northstar SPV I, LLC",
    company: "Northstar Robotics",
    jurisdiction: "Delaware, US",
  },
  {
    id: "meridian",
    name: "Meridian SPV I, LLC",
    company: "Meridian Energy",
    jurisdiction: "Wyoming, US",
  },
];
function ImportExample() {
  const [file, setFile] = useState("");
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const [fail, setFail] = useState(true);
  const later = useDemoDelay();
  const input = useRef<HTMLInputElement>(null);
  const busy = state === "reading" || state === "saving";
  const reset = () => {
    setFile("");
    setState("idle");
    setError("");
    setSelected([]);
    setApplied([]);
    if (input.current) input.current.value = "";
  };
  const preview = () => {
    setState("reading");
    setError("");
    setSelected([]);
    setApplied([]);
    later(() => setState("ready"));
  };
  const apply = () => {
    setState("saving");
    setError("");
    later(() => {
      if (fail) {
        setFail(false);
        setError("Demo updates could not be saved.");
        setState("ready");
      } else {
        setApplied(selected);
        setState("saved");
      }
    });
  };
  return (
    <Example
      title="Import table & file selection"
      description="Native file selection, inline validation, a responsive review table and retained selections on failure."
      wide
    >
      <p className="candidate-metadata">
        Synthetic preview only. File contents are not read or uploaded. Use the
        sample to inspect the review flow.
      </p>
      <div className="candidate-form">
        <AccessibleField
          label="CSV file"
          help="Choose a .csv file up to 1 MB."
          error={state === "invalid" ? error : undefined}
        >
          {(props) => (
            <Input
              {...props}
              ref={input}
              type="file"
              accept=".csv,text/csv"
              disabled={busy}
              onChange={(e) => {
                const chosen = e.currentTarget.files?.[0];
                setSelected([]);
                setApplied([]);
                if (!chosen) {
                  setFile("");
                  setState("idle");
                  setError("");
                  return;
                }
                if (
                  !chosen.name.toLowerCase().endsWith(".csv") ||
                  chosen.size > 1000000
                ) {
                  setFile("");
                  setState("invalid");
                  setError("Choose a CSV file no larger than 1 MB.");
                  return;
                }
                setFile(chosen.name);
                setState("idle");
                setError("");
              }}
            />
          )}
        </AccessibleField>
        <ActionGroup wrap>
          <Button
            onClick={() => {
              reset();
              const transfer = new DataTransfer();
              transfer.items.add(
                new File(
                  [
                    "legal_name,jurisdiction\nNorthstar SPV I LLC,Delaware US\nMeridian SPV I LLC,Wyoming US\n",
                  ],
                  "keel-demo-entities.csv",
                  { type: "text/csv" },
                ),
              );
              if (input.current) input.current.files = transfer.files;
              setFile("keel-demo-entities.csv");
            }}
          >
            Use sample CSV
          </Button>
          <Button tone="primary" disabled={!file || busy} onClick={preview}>
            {state === "reading" ? (
              <>
                <Spinner />
                Preparing preview…
              </>
            ) : (
              "Preview file"
            )}
          </Button>
          <Button tone="quiet" onClick={reset} disabled={busy}>
            Reset import
          </Button>
        </ActionGroup>
        {file && <p className="candidate-metadata">{file}</p>}
      </div>
      {state === "reading" && (
        <LoadingStatus>Preparing two synthetic entity rows…</LoadingStatus>
      )}
      {["ready", "saving", "saved"].includes(state) && (
        <div className="candidate-table-wrap">
          <table className="candidate-table" role="table">
            <caption>Demo entity updates</caption>
            <thead>
              <tr role="row">
                <th scope="col">Entity</th>
                <th scope="col">Jurisdiction</th>
                <th scope="col">Decision</th>
              </tr>
            </thead>
            <tbody>
              {importRows.map((row) => (
                <tr key={row.id} role="row">
                  <td data-label="Entity">
                    <strong>{row.name}</strong>
                    <span className="candidate-metadata">{row.company}</span>
                  </td>
                  <td data-label="Jurisdiction">{row.jurisdiction}</td>
                  <td data-label="Decision">
                    {state === "saved" ? (
                      <span>
                        {applied.includes(row.id)
                          ? "Applied in preview"
                          : "Left unchanged"}
                      </span>
                    ) : (
                      <Checkbox
                        label="Include update"
                        accessibleLabel={"Include " + row.name}
                        checked={selected.includes(row.id)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked
                              ? [...current, row.id]
                              : current.filter((id) => id !== row.id),
                          )
                        }
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {error && state !== "invalid" && (
        <FormMessage tone="error">{error}</FormMessage>
      )}
      {["ready", "saving"].includes(state) && (
        <ActionGroup wrap>
          <Button
            tone="primary"
            disabled={busy || selected.length === 0}
            onClick={apply}
          >
            {state === "saving" ? (
              <>
                <Spinner />
                Applying…
              </>
            ) : (
              "Apply " +
              selected.length +
              " selected " +
              (selected.length === 1 ? "update" : "updates")
            )}
          </Button>
          <p className="candidate-metadata">Unselected rows stay unchanged.</p>
        </ActionGroup>
      )}
      {state === "saved" && (
        <FormMessage tone="success">
          {applied.length} demo {applied.length === 1 ? "update" : "updates"}{" "}
          applied. No application records were changed.
        </FormMessage>
      )}
      <div className="candidate-demo-options">
        <Checkbox
          label="Fail next import save"
          checked={fail}
          onCheckedChange={setFail}
          disabled={busy}
        />
        <Button
          tone="quiet"
          disabled={busy}
          onClick={() => {
            reset();
            setState("invalid");
            setError("Choose a CSV file no larger than 1 MB.");
          }}
        >
          Preview file error
        </Button>
      </div>
    </Example>
  );
}
function ProgressExample() {
  const [state, setState] = useState("Partial");
  const [done, setDone] = useState(4);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    if (state !== "Running") return;
    const timer = setTimeout(() => {
      if (done >= 6) setState(fail ? "Limited" : "Complete");
      else setDone((v) => v + 1);
    }, 300);
    return () => clearTimeout(timer);
  }, [state, done, fail]);
  const choose = (v: string) => {
    setState(v);
    setDone(v === "Complete" || v === "Limited" ? 6 : v === "Partial" ? 4 : 0);
  };
  return (
    <Example
      title="Measured progress"
      description="Processed count and outcome stay distinct. Unknown totals show activity without an invented percentage."
    >
      <PreviewStates
        label="Progress preview state"
        value={state}
        values={["Partial", "Complete", "Limited", "Unknown"]}
        onChange={choose}
      />
      <div className="candidate-progress-block">
        <p className="candidate-fact-strong">
          {state === "Unknown"
            ? "Checking sources…"
            : done + " of 6 sources checked"}
        </p>
        <progress
          className="candidate-progress"
          aria-label="Sources checked"
          value={state === "Unknown" ? undefined : done}
          max={6}
        />
        {state === "Limited" ? (
          <p>5 sources read successfully. 1 source is unavailable.</p>
        ) : state === "Complete" ? (
          <p>All 6 sources read successfully.</p>
        ) : state === "Unknown" ? (
          <p className="candidate-metadata">The total is not available yet.</p>
        ) : (
          <p className="candidate-metadata">
            Previously recorded information remains available.
          </p>
        )}
      </div>
      <ActionGroup>
        <Button
          disabled={state === "Running"}
          onClick={() => {
            setDone(0);
            setState("Running");
          }}
        >
          {state === "Running" ? (
            <>
              <Spinner />
              Checking…
            </>
          ) : (
            "Run demo check"
          )}
        </Button>
      </ActionGroup>
      <div className="candidate-demo-options">
        <Checkbox
          label="One source unavailable"
          checked={fail}
          onCheckedChange={setFail}
          disabled={state === "Running"}
        />
      </div>
    </Example>
  );
}
function ProviderExample() {
  const [state, setState] = useState("Connected");
  const later = useDemoDelay();
  const check = () => {
    setState("Checking");
    later(() => setState("Connected"));
  };
  return (
    <Example
      title="Provider status & reconnect"
      description="A provider-owned flow composed from shared presentation. Demo sign-in never requests credentials."
    >
      <PreviewStates
        label="Provider preview state"
        value={state}
        values={["Connected", "Read failed", "Sign-in required", "Unavailable"]}
        onChange={setState}
      />
      <div className="catalogue-fact-values">
        <p className="candidate-fact-strong">Demo investment source</p>
        {state === "Connected" ? (
          <>
            <p>Connected</p>
            <p className="candidate-metadata">
              Last successful read · Oct 20, 2026, 10:30 AM
            </p>
          </>
        ) : state === "Checking" ? (
          <LoadingStatus>Checking for updates…</LoadingStatus>
        ) : state === "Read failed" ? (
          <Notice tone="error">
            The latest source data could not be read. Previously recorded
            holdings remain available.
          </Notice>
        ) : state === "Sign-in required" ? (
          <p>
            The provider session has expired. Sign in again to resume updates.
          </p>
        ) : state === "Waiting" ? (
          <Notice>
            Demo sign-in is waiting for you. Complete or cancel below.
          </Notice>
        ) : (
          <Notice>
            The provider is temporarily unavailable. Your existing records
            remain available.
          </Notice>
        )}
      </div>
      <ActionGroup wrap>
        {state === "Waiting" ? (
          <>
            <Button tone="primary" onClick={check}>
              Complete demo sign-in
            </Button>
            <Button tone="quiet" onClick={() => setState("Sign-in required")}>
              Cancel sign-in
            </Button>
          </>
        ) : (
          <Button
            disabled={state === "Checking"}
            onClick={() =>
              state === "Sign-in required" ? setState("Waiting") : check()
            }
          >
            {state === "Sign-in required"
              ? "Reconnect source"
              : state === "Read failed" || state === "Unavailable"
                ? "Retry source"
                : state === "Checking"
                  ? "Checking…"
                  : "Check source now"}
          </Button>
        )}
      </ActionGroup>
    </Example>
  );
}
function RecoveryExample() {
  const [state, setState] = useState("Failed");
  const later = useDemoDelay();
  return (
    <Example
      title="Route recovery"
      description="Keep the page identity, explain the observed failure and offer one useful next action."
    >
      <PreviewStates
        label="Route recovery preview"
        value={state}
        values={["Failed", "Loading", "Ready"]}
        onChange={setState}
      />
      <section className="candidate-recovery" aria-label="Entity page preview">
        <SectionHeader title="Legal entities" headingAs="h3" />
        {state === "Loading" ? (
          <LoadingStatus>Loading legal entities…</LoadingStatus>
        ) : state === "Failed" ? (
          <>
            <p>Legal entities could not be loaded.</p>
            <p className="candidate-metadata">
              This does not mean your records are empty.
            </p>
            <Button
              onClick={() => {
                setState("Loading");
                later(() => setState("Ready"));
              }}
            >
              Try loading entities again
            </Button>
          </>
        ) : (
          <RecordItem
            title="Northstar SPV I, LLC"
            detail="Northstar Robotics"
          />
        )}
      </section>
    </Example>
  );
}
export function Compositions() {
  return (
    <>
      <p className="candidate-intro">
        Synthetic Keel workflows composed from shared controls. Every action
        stays in this preview.
      </p>
      <div className="catalogue-grid candidate-examples">
        <RecordGroupExample />
        <RecordRowsExample />
        <HistoryExample />
        <ImportExample />
        <ProgressExample />
        <ProviderExample />
        <RecoveryExample />
      </div>
    </>
  );
}
