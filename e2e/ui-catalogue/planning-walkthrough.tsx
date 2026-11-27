import React, { useState, useEffect, useRef } from "react";
import {
  Panel,
  PageHeader,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  TextLink,
  Field,
  Input,
  InputGroup,
  Stat,
  StatGroup,
  ActionGroup,
  FormMessage,
} from "@keel/ui";
const pages: Record<string, string> = {
  "planning-overview": "overview",
  "planning-goal": "goals",
  "planning-scenario": "scenarios",
  "planning-history": "history",
};
const stepIds: Record<string, string> = {
  overview: "planning-overview",
  goals: "planning-goal",
  scenarios: "planning-scenario",
  history: "planning-history",
};
const href = (page: string) => `#journeys/${stepIds[page]}`;
function RunwayComparison({
  target,
  label,
  inverse = false,
}: {
  target: number | null | undefined;
  label: string;
  inverse?: boolean;
}) {
  const current = 9;
  const pct =
    target != null && target > 0
      ? Math.min(100, Number(900n / BigInt(target)))
      : null;
  return (
    <div
      className={
        inverse
          ? "runway-comparison runway-comparison--inverse"
          : "runway-comparison"
      }
    >
      <StatGroup>
        <Stat label="Current" value="9" detail="months" />
        <Stat
          label="Target"
          value={
            target === undefined
              ? "Invalid"
              : target === null
                ? "Not set"
                : String(target)
          }
          detail={target == null ? undefined : "months"}
        />
      </StatGroup>
      {pct !== null && (
        <div
          role="meter"
          aria-label={`${label}: current runway toward target`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-valuetext={`9 of ${target} months${current > target! ? "; target exceeded" : ""}`}
          className="runway-meter"
        >
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
export function PlanningWalkthrough({ stepId }: { stepId: string }) {
  const page = pages[stepId] || "overview";
  const [name, N] = useState("Demo reserve goal");
  const [metric, M] = useState("Protected runway");
  const [target, T] = useState("12");
  const measured = 9;
  const parsedTarget =
    target.trim() === ""
      ? null
      : /^\d+$/.test(target.trim()) && Number.isSafeInteger(Number(target))
        ? Number(target)
        : undefined;
  const progress = (value: number | null | undefined) =>
    value == null
      ? null
      : value === 0
        ? 100
        : Math.min(100, Number((BigInt(measured) * 100n) / BigInt(value)));
  const [note, Q] = useState("");
  const [saved, S] = useState(false);
  const [receipt, R] = useState<{
    name: string;
    note: string;
    metric: string;
    target: number | null;
  } | null>(null);
  const [error, E] = useState("");
  const [fail, F] = useState(false);
  const [busy, B] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    head.current?.focus();
    window.scrollTo(0, 0);
  }, [page]);
  const go = (s: string) => {
    if (!busy) location.hash = href(s);
  };
  const steps = ["overview", "goals", "scenarios", "history"];
  const titles = ["Overview", "Goals", "Scenarios", "Forecast History"];
  const idx = steps.indexOf(page);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !note.trim()) {
      E("Enter a goal name and describe what changed.");
      return;
    }
    if (
      !metric.trim() ||
      metric.trim().length > 120 ||
      parsedTarget === undefined
    ) {
      E(
        "Enter a measure and a whole-number target of 0 or more, or leave target blank.",
      );
      return;
    }
    B(true);
    E("");
    setTimeout(() => {
      B(false);
      if (fail) {
        F(false);
        E("The goal could not be saved. Your draft is kept.");
      } else {
        S(true);
        R({ name, note, metric: metric.trim(), target: parsedTarget });
      }
    }, 350);
  };
  return (
    <div className="planning-polished">
      <section aria-label="Synthetic application" className="planning-screen">
        <div className="planning-screen-label">
          <span>Synthetic screen</span>
          <span>{titles[idx]}</span>
        </div>
        <h2 ref={head} tabIndex={-1} className="visually-hidden">
          {titles[idx]}
        </h2>
        {page === "overview" ? (
          <>
            <section className="hero">
              <div>
                <p className="eyebrow">
                  Primary goal · saved plan v{receipt ? 2 : 1}
                </p>
                <h1>{receipt?.name || "Demo reserve goal"}</h1>
                <p className="hero__copy">
                  {receipt?.metric || "Protected runway"}
                </p>
                <TextLink
                  className="hero__action"
                  tone="inverse"
                  onClick={() => go("goals")}
                >
                  Edit goal
                </TextLink>
              </div>
              <RunwayComparison
                inverse
                label={receipt?.metric || "Protected runway"}
                target={receipt ? receipt.target : 12}
              />
            </section>
          </>
        ) : page === "goals" ? (
          <>
            <PageHeader
              eyebrow="Planning priorities"
              title="Goals"
              actions={<Badge tone="neutral">1 active goal</Badge>}
            />
            <div className="goal-edit-grid">
              <form className="goal-form" onSubmit={save} noValidate>
                <Panel
                  className="goal-form__panel"
                  eyebrow={saved ? "Saved v2" : "Editing v1"}
                  title={saved ? "Saved goal" : "Create a new version"}
                  action={<Badge tone="positive">Primary</Badge>}
                >
                  <div className="goal-form__fields">
                    <Field label="Goal name" variant="filled" wide>
                      {(props) => (
                        <Input
                          {...props}
                          value={name}
                          disabled={busy}
                          onChange={(e) => {
                            N(e.target.value);
                            S(false);
                          }}
                        />
                      )}
                    </Field>
                    <Field
                      label="How success is measured"
                      variant="filled"
                      wide
                    >
                      {(props) => (
                        <Input
                          {...props}
                          maxLength={120}
                          value={metric}
                          disabled={busy}
                          onChange={(e) => {
                            M(e.target.value);
                            S(false);
                            E("");
                          }}
                        />
                      )}
                    </Field>
                    <Field label="Target · optional" variant="filled" wide>
                      {(props) => (
                        <InputGroup suffix="months">
                          <Input
                            {...props}
                            inputMode="numeric"
                            value={target}
                            disabled={busy}
                            onChange={(e) => {
                              T(e.target.value);
                              S(false);
                              E("");
                            }}
                          />
                        </InputGroup>
                      )}
                    </Field>
                    <Field
                      label="What changed"
                      description="Required for this version."
                      error={error || undefined}
                      variant="filled"
                      wide
                    >
                      {(props) => (
                        <Input
                          {...props}
                          value={note}
                          disabled={busy}
                          onChange={(e) => {
                            Q(e.target.value);
                            S(false);
                            E("");
                          }}
                        />
                      )}
                    </Field>
                  </div>
                  <ActionGroup>
                    <Button
                      type="submit"
                      tone="primary"
                      disabled={busy || saved}
                    >
                      {busy ? "Saving…" : "Save new version"}
                    </Button>
                  </ActionGroup>
                  {saved && (
                    <div role="status">
                      <FormMessage tone="success">
                        Saved as version 2 with a matching forecast snapshot.
                      </FormMessage>
                    </div>
                  )}
                </Panel>
              </form>
              <Panel
                className="goal-preview"
                eyebrow="Live preview"
                title={name || "Untitled goal"}
              >
                <p className="eyebrow">{metric || "Unnamed measure"}</p>
                <RunwayComparison
                  label={metric || "Runway"}
                  target={parsedTarget}
                />
                <p className="catalogue-note">
                  Current runway stays fixed. Target edits do not recalculate
                  scenario forecasts.
                </p>
              </Panel>
            </div>
          </>
        ) : page === "scenarios" ? (
          <>
            <PageHeader
              eyebrow="Scenario comparison"
              title="Demo base case"
              actions={<Badge tone="neutral">Read-only excerpt</Badge>}
            />
            <StatGroup className="planning-scenario-metrics">
              <Stat
                label="Conditional value"
                value="$80,000"
                detail="If modeled liquidity events occur"
              />
              <Stat
                label="Liquidity"
                value="$50,000"
                detail="Timing-adjusted · not cash in hand"
              />
            </StatGroup>
            <p className="catalogue-note">
              No scenario changes or saves in this walkthrough.
            </p>
          </>
        ) : (
          <>
            <PageHeader
              eyebrow="Saved decisions"
              title="Forecast History"
              actions={<Badge tone="neutral">Read-only record</Badge>}
            />
            <Panel className="history-panel">
              <div className="history-list">
                <article>
                  <div className="history-rail">
                    <span>{receipt ? 2 : 1}</span>
                    <i />
                  </div>
                  <div className="history-content">
                    <header>
                      <div>
                        <Badge tone="neutral">Demo reserve plan</Badge>
                        <h2>
                          {receipt
                            ? "Version 2 · goal revision"
                            : "Version 1 · baseline"}
                        </h2>
                      </div>
                    </header>
                    <p>{receipt?.note || "Existing synthetic baseline"}</p>
                    {receipt && (
                      <div className="history-comparison">
                        <span>
                          Prior middle<b>$50,000</b>
                        </span>
                        <span>
                          New middle<b>$50,000</b>
                        </span>
                      </div>
                    )}
                    {receipt && (
                      <p>
                        {receipt.metric} · Target:{" "}
                        {receipt.target === null
                          ? "None"
                          : `${receipt.target} months`}{" "}
                        · Measured runway: 9 months
                        {receipt.target !== null && receipt.target > 0
                          ? ` · ${progress(receipt.target)}% of target`
                          : ""}
                      </p>
                    )}
                    <small>
                      {receipt
                        ? "Goal revision · scenario forecast unchanged"
                        : "Save the goal to add its matching snapshot."}
                    </small>
                  </div>
                </article>
              </div>
            </Panel>
          </>
        )}
        <nav
          className="planning-main-navigation"
          aria-label="Application navigation"
        >
          <span>Main navigation</span>
          {titles.map((title, i) => (
            <TextLink
              key={title}
              href={href(steps[i]!)}
              aria-current={page === steps[i] ? "page" : undefined}
              onClick={(e: React.MouseEvent) => {
                if (busy) e.preventDefault();
              }}
            >
              {title}
            </TextLink>
          ))}
        </nav>
      </section>
      <Collapsible className="planning-context">
        <CollapsibleTrigger layout="inline">
          Scope, source & demo controls <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p>
            Local simulation only: edit the goal name, measure label and
            optional target, add a required note and save. Saving stays in
            Goals. Scenarios and History are deliberate main-navigation choices,
            not redirects. No scenario editor, forecast calculation, restore or
            real writes.
          </p>
          <p>
            Product route: {["/", "/goals", "/scenarios", "/history"][idx]}.
            Source: App.tsx OverviewGoalHero / Goals / Scenarios /
            ForecastHistory at 06e63a7. Screen excerpts use Keel’s goal hero,
            goal-edit grid, preview, scenario summary and history rail. Fixed
            synthetic measured runway is 9 months, separate from the goal target
            (dashboard.protectedRunwayMonths). Label and target changes update
            the goal preview and saved receipt only; scenario values stay fixed.
            Nonnegative safe integer months or blank follows parseGoalInteger
            and GoalDraftInputSchema. Fixed fabricated scenario values; no
            network, storage or credentials. Other product fields are omitted.
          </p>
          <ActionGroup wrap>
            <Button
              disabled={busy}
              onClick={() => F(!fail)}
              aria-pressed={fail}
            >
              Fail next goal save: {fail ? "on" : "off"}
            </Button>
            <Button
              disabled={busy}
              tone="quiet"
              onClick={() => {
                N("Demo reserve goal");
                M("Protected runway");
                T("12");
                Q("");
                S(false);
                R(null);
                E("");
                F(false);
                go("overview");
              }}
            >
              Reset demonstration
            </Button>
          </ActionGroup>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
