import { useEffect, useRef, useState } from "react";
import {
  EmptyState,
  ActionGroup,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  FormMessage,
  PageHeader,
  Panel,
  RecordItem,
  SectionHeader,
  Stat,
  StatGroup,
  TextLink,
} from "@keel/ui";
let demoDecision: "pending" | "applied" | "ignored" = "pending";
export function EvidenceWalkthrough({ stepId }: { stepId: string }) {
  const evidence = true;
  const [view, View] = useState<"report" | "inbox" | "history">("report");
  const [decision, Decision] = useState(demoDecision);
  const applied = decision === "applied";
  const [busy, B] = useState(false),
    [error, E] = useState(""),
    [fail, F] = useState(false);

  useEffect(() => {
    if (decision !== "pending") heading.current?.focus();
  }, [decision]);
  const heading = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    heading.current?.focus();
  }, [stepId]);
  function save(kind: "ignore" | "apply") {
    if (busy) return;
    B(true);
    E("");
    timer.current = setTimeout(() => {
      B(false);
      if (fail) {
        F(false);
        E("The review could not be saved. Your choices are kept.");
        return;
      }
      demoDecision = kind === "apply" ? "applied" : "ignored";
      Decision(demoDecision);
    }, 350);
  }
  const body = evidence ? (
    view !== "report" ? (
      <section
        aria-label={view === "inbox" ? "Pending decisions" : "Evidence history"}
      >
        <SectionHeader title={view === "inbox" ? "Pending" : "History"} />
        {view === "inbox" && decision !== "pending" ? (
          <EmptyState title="No pending reports" />
        ) : (
          <RecordItem
            title="Northstar Robotics"
            detail={`Brokerage A · ${decision === "pending" ? "Pending review" : decision === "ignored" ? "Ignored" : "Applied"}`}
            metadata={`Current ${applied ? "$20,000" : "$18,000"} · Reported $20,000`}
            action={
              <Button
                onClick={() => {
                  View("report");
                  E("");
                  setTimeout(() => heading.current?.focus(), 0);
                }}
              >
                View report
              </Button>
            }
          />
        )}
      </section>
    ) : stepId === "evidence-scenario" ? (
      <Panel title="Scenario-only exploration">
        <p>
          Scenario-only is a separate planning path, not evidence acceptance.
          This shallow demo does not model that alternate.
        </p>
        <TextLink href="#journeys/evidence-review">Back to evidence</TextLink>
      </Panel>
    ) : (
      <article className="evidence-card">
        <SectionHeader
          title="Northstar Robotics"
          description="Brokerage A · Position value"
          descriptionPlacement="title-group"
          descriptionProps={{ className: "catalogue-note" }}
        />
        <StatGroup className="evidence-value-comparison">
          <Stat label="Current value" value={applied ? "$20,000" : "$18,000"} />
          <Stat label="Reported value" value="$20,000" />
        </StatGroup>
        <div>
          <h4 className="candidate-source-heading">Source</h4>
          <p className="catalogue-note">
            Demo administrator statement · “Reported position value: $20,000.”
            Synthetic evidence only.
          </p>
        </div>
        {decision !== "pending" ? (
          <FormMessage tone={applied ? "success" : "neutral"}>
            {applied
              ? "Applied to Northstar Robotics · Brokerage A. Current value is $20,000."
              : "Ignored. Current value remains $18,000. This report is kept in History."}
          </FormMessage>
        ) : (
          <section
            className="evidence-confirmation"
            aria-label="Evidence decisions"
          >
            <ActionGroup wrap>
              <Button
                tone="primary"
                disabled={busy}
                onClick={() => save("apply")}
              >
                {busy ? "Saving…" : "Apply"}
              </Button>
              <Button disabled={busy} onClick={() => save("ignore")}>
                Ignore
              </Button>
            </ActionGroup>
          </section>
        )}

        {error && <FormMessage tone="error">{error}</FormMessage>}
      </article>
    )
  ) : null;
  return (
    <section
      aria-label="Synthetic application"
      className={`catalogue-decision-demo ${evidence ? "catalogue-evidence-demo" : ""}`}
    >
      <div ref={heading} tabIndex={-1} className="decision-heading">
        <PageHeader
          title={"Evidence Inbox"}
          description={
            "Review a reported change before deciding what it should affect."
          }
        />
      </div>
      {evidence ? (
        <Tabs
          value={
            view === "history" || (view === "report" && decision !== "pending")
              ? "history"
              : "inbox"
          }
          onValueChange={(v) => {
            View(
              v === "history"
                ? "history"
                : decision === "pending"
                  ? "report"
                  : "inbox",
            );
            E("");
          }}
        >
          <TabsList variant="line" aria-label="Evidence views">
            <TabsTrigger
              value="inbox"
              onClick={() => {
                View(decision === "pending" ? "report" : "inbox");
                E("");
              }}
            >
              Inbox
            </TabsTrigger>
            <TabsTrigger
              value="history"
              onClick={() => {
                View("history");
                E("");
              }}
            >
              History
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value={
              view === "history" ||
              (view === "report" && decision !== "pending")
                ? "history"
                : "inbox"
            }
          >
            {body}
          </TabsContent>
        </Tabs>
      ) : (
        body
      )}
      <Collapsible className="evidence-prototype">
        <CollapsibleTrigger layout="inline">
          Prototype controls and source <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="catalogue-note">
            Synthetic-only screen excerpts. No requests, storage, payment or
            application writes. Source revision 06e63a7, App.tsx Watch and
            EvidenceCard. Route labels identify the corresponding product
            screen. Catalogue links stay in this walkthrough.
          </p>
          <Button tone="quiet" disabled={busy} onClick={() => F(!fail)}>
            Fail next review: {fail ? "on" : "off"}
          </Button>
          <p className="catalogue-note">
            {evidence
              ? "Proposed pattern, not shipped: Apply and Ignore replace the production acceptance choices. Ignore is not acceptance or deletion. Leaving through navigation keeps pending reports unchanged. History retains pending, applied and ignored report states in memory until reload; no storage or external changes. Ordinary mapped, non-financing, non-superseded synthetic report demo-event. Watch remains a separate product feed."
              : ""}
          </p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
