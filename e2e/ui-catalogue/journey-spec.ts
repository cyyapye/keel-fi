import { taskJourneys } from "./task-journey-spec";
import { groups } from "./catalogue-manifest";

/** Reference metadata only. Financial fixtures belong to the browser catalogue. */
export const journeyVersion = {
  version: 1,
  sourceRevision: "06e63a7ea70873dfecf1f4d701163dae3bd49b9c",
  approvedProposalSha256:
    "2f8bf2dcf1620fc6fb3e36463f3890fc08912e5e631a3bfced2b607c4a341e9a",
} as const;
export const areas = [
  ["overview", "Overview", "See portfolio value, concentration and access."],
  ["goals", "Goals", "Set the outcomes planning should serve."],
  ["holdings", "Holdings", "Understand what you own and its evidence."],
  ["obligations", "Obligations", "Understand committed outflows."],
  ["watch", "Portfolio Watch", "Monitor portfolio developments."],
  ["evidence", "Evidence Inbox", "Review incoming evidence."],
  ["scenarios", "Scenarios", "Explore planning alternatives."],
  ["forecasts", "Forecast History", "Revisit recorded forecasts."],
  ["settings", "Settings", "Manage application configuration."],
] as const;
export const steps = [
  {
    id: "portfolio",
    title: "Portfolio",
    source: "apps/web/src/PortfolioSnapshot.tsx",
    components: ["StatGroup", "Stat", "TextLink"],
    trigger: "Open a company exposure.",
    result: "Open the matching group in Holdings.",
    context: "The selected company becomes the exposure filter.",
  },
  {
    id: "company",
    title: "Company exposure",
    source: "apps/web/src/InvestmentHoldings.tsx",
    components: ["RecordGroup", "RecordRow", "TextLink"],
    trigger: "Open Brokerage A’s position.",
    result:
      "Enter one account-specific position, not a combined company record.",
    context:
      "Keep the company group as the return destination. Holdings remain separate.",
  },
  {
    id: "position",
    title: "Holding position",
    source: "apps/web/src/App.tsx",
    components: ["SectionHeader", "StatGroup", "Stat", "TextLink"],
    trigger: "Choose Activity.",
    result: "Show reported investment events for this position.",
    context:
      "Account and position remain the scope. History adds no current value.",
  },
  {
    id: "activity",
    title: "Activity",
    source: "apps/web/src/InvestmentHistory.tsx",
    components: ["Tabs", "RecordItem", "Collapsible", "Button"],
    trigger: "Choose Tax lots, or switch to account activity.",
    result:
      "Lots show reported remaining holdings. Account activity hides lots.",
    context:
      "Position tabs keep position scope. Account activity is a separate scope.",
  },
  {
    id: "lots",
    title: "Tax lots",
    source: "apps/web/src/InvestmentHistory.tsx",
    components: ["Tabs", "RecordItem", "EmptyState"],
    trigger: "Back to holdings.",
    result: "Return to the company group and its independent positions.",
    context:
      "This reference restores the company group. Exact production focus and scroll replay still need live verification.",
  },
] as const;
export type StepId = (typeof steps)[number]["id"];
export const edges = [
  { from: "portfolio", to: "company", action: "View exposure" },
  { from: "company", to: "position", action: "Open position" },
  { from: "position", to: "activity", action: "Activity" },
  { from: "activity", to: "lots", action: "Tax lots" },
  { from: "lots", to: "company", action: "Back to holdings" },
] as const;
export function componentPage(name: string) {
  return Object.values(groups).find((group) => group.names.includes(name))
    ?.page;
}
export function stepsUsing(names: readonly string[]) {
  return [
    ...steps.filter((step) =>
      step.components.some((name) => names.includes(name)),
    ),
    ...(names.some((name) =>
      [
        "SectionHeader",
        "Stat",
        "Tabs",
        "RecordGroup",
        "RecordRow",
        "Select",
        "Collapsible",
      ].includes(name),
    )
      ? [{ id: "holdings-total", title: "Reconcile holdings" }]
      : []),
    ...(names.some((name) =>
      [
        "Collapsible",
        "RecordGroup",
        "RecordRow",
        "SectionHeader",
        "Stat",
        "TextLink",
      ].includes(name),
    )
      ? [{ id: "cash-history", title: "Cash account history" }]
      : []),
    ...(names.some((name) => ["Button", "Notice", "TextLink"].includes(name))
      ? [{ id: "baseline-refresh", title: "Routine planning refresh" }]
      : []),
    ...(names.some((name) =>
      [
        "ActionGroup",
        "Field",
        "Input",
        "InputGroup",
        "Button",
        "TextLink",
      ].includes(name),
    )
      ? [{ id: "baseline-exceptions", title: "Review one planning source" }]
      : []),
    ...(names.some((name) =>
      [
        "Button",
        "Collapsible",
        "DataList",
        "Field",
        "InputGroup",
        "Select",
        "Stat",
      ].includes(name),
    )
      ? [{ id: "observed-burn", title: "Observed burn and runway" }]
      : []),
    ...taskJourneys.flatMap((journey) =>
      journey.steps
        .filter((step) => step.components?.some((name) => names.includes(name)))
        .map(({ id, title }) => ({ id, title })),
    ),
    ...(names.some((name) => name === "RecordItem" || name === "TextLink")
      ? taskJourneys
          .filter(
            (journey) =>
              ![
                "cash",
                "baseline",
                "observed-burn",
                "holding-maintenance",
              ].includes(journey.id),
          )
          .map((journey) => ({
            id: journey.steps[0]!.id,
            title: journey.title,
          }))
      : []),
  ];
}
export function validateJourney() {
  const ids = new Set(steps.map((step) => step.id));
  if (ids.size !== steps.length) throw new Error("Duplicate journey step ID");
  for (const edge of edges)
    if (!ids.has(edge.from) || !ids.has(edge.to) || !edge.action)
      throw new Error("Invalid journey edge");
  for (const step of steps)
    for (const name of step.components)
      if (!componentPage(name)) throw new Error(`Unknown component: ${name}`);
}
validateJourney();
