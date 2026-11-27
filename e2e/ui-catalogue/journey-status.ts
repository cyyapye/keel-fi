// Status describes the product behavior shown by the fixture. An approval to
// build a catalogue example does not authorize its adoption in the app.
import { valuationRoute } from "./valuation-scenarios";

type StepStatus = {
  detail: string;
  evidence: string;
} & (
  | { stage: "Proposal" | "Shipped" }
  | { stage: "Approved for implementation"; approvalSha256: string }
);

function shipped(detail: string, evidence: string): StepStatus {
  return { stage: "Shipped", detail, evidence };
}
function proposal(detail: string, evidence: string): StepStatus {
  return { stage: "Proposal", detail, evidence };
}

const app = "apps/web/src/App.tsx";
const holdings = "apps/web/src/InvestmentHoldings.tsx";
const history = "apps/web/src/InvestmentHistory.tsx";
const access = "apps/web/src/AppAccess.tsx";
const gp = "apps/web/src/HoldingValuation.tsx";
const obligations = proposal(
  "Inbox and History for obligations. Keel already supports reviewing payment treatment and its impact on runway.",
  "apps/web/src/Obligations.tsx",
);
export const evidenceProposalRoute = "evidence-review/proposals/apply-ignore";
const simplifiedEvidence = proposal(
  "This is the Apply / Ignore design. Keel currently offers separate review, scenario and application choices.",
  app,
);

const byId: Readonly<Record<string, StepStatus | undefined>> = {
  portfolio: shipped(
    "Open a company exposure from Overview.",
    "apps/web/src/PortfolioSnapshot.tsx",
  ),
  company: shipped(
    "Inspect the separate positions in a Holdings exposure group.",
    holdings,
  ),
  position: shipped("Open the selected position and its activity.", app),
  activity: shipped(
    "Read position or account activity in the holding’s Activity tab.",
    history,
  ),
  lots: shipped(
    "Inspect reported lots in the position’s Tax lots tab.",
    history,
  ),
  "holdings-total": shipped(
    "Reconcile the total across legal positions and underlying exposures.",
    holdings,
  ),
  "holdings-total-position": shipped(
    "Open the legal position that needs a valuation.",
    holdings,
  ),
  "holdings-total-valuation": shipped(
    "Add or change the position’s valuation. Evidence choices here are simulated.",
    gp,
  ),
  "planning-overview": proposal(
    "Current and target runway shown on a meter. Keel already lets you open a saved goal from Overview.",
    app,
  ),
  "planning-goal": proposal(
    "A runway meter beside the draft goal. Saving a goal already records its version and forecast in Keel.",
    app,
  ),
  "planning-scenario": shipped(
    "Open Scenarios separately to compare planning assumptions. This example uses fixed results.",
    app,
  ),
  "planning-history": shipped(
    "Open Forecast History to inspect saved forecasts.",
    app,
  ),
  "evidence-watch": shipped(
    "Open a Watch update to review that report in Evidence.",
    app,
  ),
  "evidence-review": shipped(
    "Review the chosen report with the decisions available for its claim.",
    "apps/web/src/WatchEvidenceReport.tsx",
  ),
  "evidence-scenario": shipped(
    "Inspect the reviewed report’s context in Scenarios.",
    app,
  ),
  [evidenceProposalRoute]: simplifiedEvidence,
  "obligations-proposal": obligations,
  "obligations-review": obligations,
  "obligations-impact": obligations,
  "source-updates-sources": proposal(
    "Open a position’s selected value directly from the accepted source report.",
    "apps/web/src/HoldingImportOutcome.tsx",
  ),
  "source-updates-outcome": proposal(
    "See why one position’s value changed or stayed the same. Keel already applies eligible updates to a followed GP total.",
    "packages/database/src/gp-reported-totals.ts",
  ),
  "source-updates-entities": shipped(
    "Inspect legal vehicles and ownership profiles in Holdings.",
    "apps/web/src/LegalEntities.tsx",
  ),
  "app-access-settings": shipped(
    "Inspect connected apps, API keys and their permissions. This walkthrough is read-only.",
    access,
  ),
  "app-access-consent": shipped(
    "Review an incoming connection request’s scope and lifetime. This walkthrough grants no access.",
    access,
  ),
  "app-access-lifecycle": shipped(
    "Inspect access lifetime and revocation. The examples here are read-only.",
    access,
  ),
};

const closeDecision = shipped(
  "Review the closing price and choose a valuation source for the eligible positions together.",
  "apps/web/src/MarketCloseReview.tsx",
);
const watch = shipped(
  "Inspect filing news and pending valuation decisions in Portfolio Watch. The example feed is simulated.",
  "apps/web/src/PortfolioWatchMonitor.tsx",
);
const closeDetail = shipped(
  "Inspect the selected closing-price estimate alongside the position’s own GP evidence.",
  "apps/web/src/SpvHoldingDetail.tsx",
);
const gpDetail = shipped(
  "Inspect the individual position’s price source and valuation basis.",
  "apps/web/src/SpvHoldingDetail.tsx",
);
const gpReview = proposal(
  "A shorter GP source picker. Keel’s valuation editor already supports choosing a price source for a position.",
  gp,
);
const gpHoldings = proposal(
  "Show GP source changes in the Holdings summary. Keel already distinguishes a followed price from a one-time estimate.",
  gp,
);

export function journeyStepStatus(route?: string): StepStatus | undefined {
  if (!route) return;
  if (Object.hasOwn(byId, route)) return byId[route];
  const id = route.split("/")[0]!;
  const valuation = valuationRoute(id);
  if (!valuation) return Object.hasOwn(byId, id) ? byId[id] : undefined;
  const { scenario, step } = valuation;
  if (scenario === "closing-price") {
    if (step === "review" || step === "watch-review") return closeDecision;
    if (step === "watch" || step === "watch-decisions" || step === "watch-all")
      return watch;
    if (step === "holdings")
      return shipped(
        "Open the eligible exposure’s closing-price review from Holdings.",
        holdings,
      );
    return closeDetail;
  }
  if (step === "review") return gpReview;
  if (step !== "holdings") return gpDetail;
  return scenario === "gp-separate"
    ? shipped(
        "Inspect the separately reported marks for positions in one company.",
        holdings,
      )
    : gpHoldings;
}
