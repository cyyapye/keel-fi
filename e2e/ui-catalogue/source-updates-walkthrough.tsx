import { useEffect, useRef, useState } from "react";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  RecordItem,
  SectionHeader,
  Stat,
  TextLink,
} from "@keel/ui";
import { DetailLink } from "./detail-link";
const money = (minor: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(minor / 100);
const cases = {
  ordinary: {
    value: 2600000,
    previous: 2400000,
    reported: 2600000,
    reportedDate: "15 November 2026",
    selectedDate: "15 November 2026",
    title: "Updated automatically",
    reason:
      "This holding follows the linked GP-reported total. The accepted report updated its selected value.",
  },
  selected: {
    value: 2100000,
    previous: 2100000,
    reported: 2600000,
    reportedDate: "15 November 2026",
    selectedDate: "10 November 2026",
    title: "Selected value unchanged",
    reason:
      "Your separately selected estimate remains in use. The newer source report did not replace it.",
  },
  incomplete: {
    value: 2400000,
    previous: 2400000,
    reported: null,
    reportedDate: "15 November 2026",
    selectedDate: "1 November 2026",
    title: "Previous value retained",
    reason:
      "The latest report has no reported amount. Keel keeps the last valid selected value.",
  },
  undated: {
    value: 2400000,
    previous: 2400000,
    reported: 2600000,
    reportedDate: null,
    selectedDate: "1 November 2026",
    title: "Previous value retained",
    reason:
      "The report has no observation date, so Keel cannot tell whether it is newer than the value in use.",
  },
  changed: {
    value: 2800000,
    previous: 2600000,
    reported: 2800000,
    reportedDate: "16 November 2026",
    selectedDate: "16 November 2026",
    title: "Updated automatically",
    reason:
      "The next accepted report updated the GP-reported total this holding follows.",
  },
} as const;
type Case = keyof typeof cases;
const labels: Record<Case, string> = {
  ordinary: "Followed GP total",
  selected: "Selected estimate",
  incomplete: "Missing amount",
  undated: "Missing date",
  changed: "Next report",
};
let selectedScenario: Case = "ordinary";
export function SourceUpdatesWalkthrough({ stepId }: { stepId: string }) {
  const [scenario, setScenario] = useState<Case>(selectedScenario);
  const [details, setDetails] = useState(false);
  const result = cases[scenario];
  const heading = useRef<HTMLElement>(null);
  useEffect(() => {
    setDetails(false);
    heading.current?.focus();
  }, [stepId]);
  if (stepId === "source-updates-sources")
    return (
      <section
        className="catalogue-decision-demo source-update-outcome"
        aria-label="Accepted source updates"
        ref={heading}
        tabIndex={-1}
      >
        <SectionHeader title="Holding sources" />
        <RecordItem
          className="catalogue-drill-in-row"
          title="Demo Cedar Fund"
          detail="Demo institution · Accepted source report"
          metadata={
            result.reportedDate
              ? `Observation date: ${result.reportedDate}`
              : "Observation date not provided"
          }
          action={
            <DetailLink
              href="#journeys/source-updates-outcome"
              label="View value outcome for Demo Cedar Fund"
            />
          }
        />
        <p className="catalogue-note">
          Inspect what the accepted report changed. Unresolved import exceptions
          are reviewed separately.
        </p>
        <TextLink href="#journeys/source-updates-entities">
          Legal entity context
        </TextLink>
      </section>
    );
  return (
    <section
      aria-label="Accepted source value outcome"
      ref={heading}
      tabIndex={-1}
      className="catalogue-decision-demo source-update-outcome"
    >
      <SectionHeader
        title="Demo Cedar Fund"
        description={result.title}
        descriptionPlacement="title-group"
      />
      <Stat label="Value Keel uses" value={money(result.value)} />
      <p className="catalogue-note">
        {scenario === "selected" ? "Selected estimate" : "GP-reported total"} ·
        As of {result.selectedDate}
      </p>
      {result.value !== result.previous && (
        <p>
          {money(result.value - result.previous)} increase from{" "}
          {money(result.previous)}.
        </p>
      )}
      <p>{result.reason}</p>
      <p className="catalogue-note">
        Demo institution ·{" "}
        {result.reportedDate
          ? `Source observation: ${result.reportedDate}`
          : "Observation date not provided"}
      </p>
      <Collapsible open={details} onOpenChange={setDetails}>
        <CollapsibleTrigger render={<Button tone="secondary" />}>
          Report details
        </CollapsibleTrigger>
        <CollapsibleContent>
          <DataList layout="rows">
            <DataItem label="Previous value" value={money(result.previous)} />
            <DataItem
              label="Latest source report"
              value={
                result.reported === null
                  ? "Amount not reported"
                  : money(result.reported)
              }
            />
            <DataItem label="Source captured" value="17 November 2026" />
            <DataItem
              label="Per-share price date"
              value="Unchanged by this report"
            />
          </DataList>
        </CollapsibleContent>
      </Collapsible>
      <TextLink href="#journeys/source-updates-sources">
        Back to sources
      </TextLink>
      <Collapsible>
        <CollapsibleTrigger render={<Button tone="quiet" />}>
          Prototype controls and source
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ActionGroup wrap>
            {(Object.keys(cases) as Case[]).map((key) => (
              <Button
                key={key}
                aria-pressed={scenario === key}
                tone={scenario === key ? "primary" : "secondary"}
                onClick={() => {
                  selectedScenario = key;
                  setScenario(key);
                  setDetails(false);
                }}
              >
                {labels[key]}
              </Button>
            ))}
          </ActionGroup>
          <p className="catalogue-note">
            Synthetic accepted-source examples. No upload, acceptance or
            financial write is performed. This value outcome is separate from
            unresolved import exceptions and legal-entity review.
          </p>
          <p className="catalogue-note">
            Canonical policy: packages/database/src/gp-reported-totals.ts. Only
            an explicitly followed, eligible, dated GP total updates the
            selected value; other selected values remain unchanged.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
