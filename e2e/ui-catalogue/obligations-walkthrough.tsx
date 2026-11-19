import { useEffect, useRef, useState } from "react";
import {
  ActionGroup,
  Button,
  Checkbox,
  EmptyState,
  Field,
  FormMessage,
  Input,
  PageHeader,
  RecordItem,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatGroup,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@keel/ui";
type Treatment = "reserve_from_liquidity" | "already_in_plan";
type Draft = { included: boolean; treatment: Treatment; note: string };
const initial: Draft = {
  included: true,
  treatment: "reserve_from_liquidity",
  note: "Reviewed Demo revolving credit obligations and payment treatment.",
};
let savedDraft = { ...initial };
let savedReview: Draft | null = null;
const treatments: Record<Treatment, string> = {
  reserve_from_liquidity: "Reserve next payment from liquidity",
  already_in_plan: "Already included in the plan",
};
export function ObligationsWalkthrough({ stepId }: { stepId: string }) {
  const [draft, setDraft] = useState(savedDraft);
  const [review, setReview] = useState(savedReview);
  const [view, setView] = useState<"report" | "inbox" | "history">(
    stepId === "obligations-impact" ? "history" : "report",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [fail, setFail] = useState(false);
  const heading = useRef<HTMLDivElement>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = (changes: Partial<Draft>) => {
    savedDraft = { ...draft, ...changes };
    setDraft(savedDraft);
  };
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    setBusy(false);
    setError("");
    setView(stepId === "obligations-impact" ? "history" : "report");
    heading.current?.focus();
  }, [stepId]);
  const selectedTab =
    view === "history" || (view === "report" && review !== null)
      ? "history"
      : "inbox";
  const nextReserve =
    draft.included && draft.treatment === "reserve_from_liquidity"
      ? "$120"
      : "$0";
  function apply() {
    if (busy || review || !draft.note.trim()) return;
    setBusy(true);
    setError("");
    timer.current = setTimeout(() => {
      setBusy(false);
      if (fail) {
        setFail(false);
        setError("The review could not be saved. Your choices are kept.");
        return;
      }
      savedReview = { ...draft, note: draft.note.trim() };
      setReview(savedReview);
      heading.current?.focus();
    }, 350);
  }
  function tab(value: string) {
    setView(value === "history" ? "history" : review ? "inbox" : "report");
    setError("");
  }
  const report = review ? (
    <article className="obligations-card">
      <SectionHeader
        title="Demo revolving credit"
        description={
          review.included ? "Obligation added" : "Obligation excluded"
        }
        descriptionPlacement="title-group"
      />
      <p className="catalogue-note">
        Demo institution · Reported 15 November 2026
      </p>
      <StatGroup className="obligations-pair">
        <Stat label="Debt added" value={review.included ? "$2,400" : "$0"} />
        <Stat
          label="Additional payment reserve"
          value={
            review.included && review.treatment === "reserve_from_liquidity"
              ? "$120"
              : "$0"
          }
        />
      </StatGroup>
      <p className="catalogue-note">
        {!review.included
          ? "The proposal was reviewed but not added to the plan."
          : review.treatment === "reserve_from_liquidity"
            ? "$120 is reserved from liquidity for the next payment."
            : "The next payment is already in the plan. No additional reserve."}{" "}
        No payment was made.
      </p>
    </article>
  ) : (
    <article className="obligations-card">
      <SectionHeader
        title="Demo revolving credit"
        description="New obligation · Credit card"
        descriptionPlacement="title-group"
        descriptionProps={{ className: "catalogue-note" }}
      />
      <StatGroup className="obligations-pair">
        <Stat label="Outstanding balance" value="$2,400" />
        <Stat label="Next payment" value="$120" detail="Due 1 December 2026" />
      </StatGroup>
      <Checkbox
        label="Use this obligation"
        checked={draft.included}
        onCheckedChange={(included) => update({ included })}
        disabled={busy}
      />
      {draft.included ? (
        <Field label="Next-payment treatment">
          <Select
            value={draft.treatment}
            items={Object.entries(treatments).map(([value, label]) => ({
              value,
              label,
            }))}
            onValueChange={(v) => {
              if (v === "reserve_from_liquidity" || v === "already_in_plan")
                update({ treatment: v });
            }}
            disabled={busy}
          >
            <SelectTrigger aria-label="Next-payment treatment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(treatments).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      <section
        className="proposal-reserve-impact"
        aria-label="Proposed planning change"
        aria-live="polite"
      >
        <SectionHeader title="Additional payment reserve" />
        <StatGroup className="obligations-pair">
          <Stat label="Current" value="$0" />
          <Stat label="After review" value={nextReserve} />
        </StatGroup>
        <p className="catalogue-note">
          {!draft.included
            ? "This obligation will not be added to the plan."
            : draft.treatment === "reserve_from_liquidity"
              ? "Adds $2,400 in debt. Reserves only the $120 next payment, not the full balance."
              : "Adds $2,400 in debt. The next payment is already in the plan, so no additional reserve."}
        </p>
      </section>
      <details className="obligations-review-detail">
        <summary>Review note and source</summary>
        <Field label="Review note" htmlFor="obligation-demo-note">
          <Input
            id="obligation-demo-note"
            maxLength={500}
            value={draft.note}
            disabled={busy}
            onChange={(e) => update({ note: e.target.value })}
          />
        </Field>
        <p className="catalogue-note">
          Demo institution · reported 15 November 2026
        </p>
      </details>
      {!draft.note.trim() && (
        <FormMessage tone="error">Add a review note to apply.</FormMessage>
      )}
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <ActionGroup wrap>
        <Button
          tone="primary"
          disabled={busy || !draft.note.trim()}
          onClick={apply}
        >
          {busy ? "Applying…" : "Apply review"}
        </Button>
      </ActionGroup>
    </article>
  );
  return (
    <section
      aria-label="Synthetic application"
      className="catalogue-obligations-demo"
    >
      <div ref={heading} tabIndex={-1} className="decision-heading">
        <PageHeader title="Obligations" />
      </div>
      <Tabs value={selectedTab} onValueChange={tab}>
        <TabsList variant="line" aria-label="Obligation views">
          <TabsTrigger value="inbox" onClick={() => tab("inbox")}>
            Inbox
          </TabsTrigger>
          <TabsTrigger value="history" onClick={() => tab("history")}>
            History
          </TabsTrigger>
        </TabsList>
        <TabsContent value={selectedTab}>
          {view === "report" ? (
            report
          ) : view === "inbox" ? (
            <EmptyState title="No pending obligations" />
          ) : !review ? (
            <EmptyState title="No reviewed obligations" />
          ) : (
            <RecordItem
              title="Demo revolving credit"
              detail={review.included ? "Added to plan" : "Excluded"}
              action={
                <Button
                  onClick={() => {
                    setView("report");
                    heading.current?.focus();
                  }}
                >
                  View review
                </Button>
              }
            />
          )}
        </TabsContent>
      </Tabs>
      <details className="obligations-prototype">
        <summary>Prototype controls and source</summary>
        <p className="catalogue-note">
          Synthetic new-obligation example. No requests, payment, storage or
          application writes. Choices persist through navigation in this
          preview; reloading resets the demo. Source: Obligations.tsx, revision
          06e63a7. Excluding an update would retain a previously accepted
          obligation; this example has none.
        </p>
        <Button
          tone="quiet"
          disabled={busy || review !== null}
          onClick={() => setFail(!fail)}
        >
          Fail next review: {fail ? "on" : "off"}
        </Button>
      </details>
    </section>
  );
}
