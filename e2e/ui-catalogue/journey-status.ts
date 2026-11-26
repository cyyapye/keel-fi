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
  "The Inbox and History layout is proposed. Keel already supports reviewing payment treatment and its impact on runway.",
  "apps/web/src/Obligations.tsx",
);
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
    "The Current / Target meter is proposed. Opening a saved goal from Overview is available in Keel.",
    app,
  ),
  "planning-goal": proposal(
    "The runway meter is proposed. Saving a goal version and its forecast is available in Keel.",
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
  "evidence-watch": simplifiedEvidence,
  "evidence-review": simplifiedEvidence,
  "evidence-scenario": simplifiedEvidence,
  "obligations-proposal": obligations,
  "obligations-review": obligations,
  "obligations-impact": obligations,
  "source-updates-sources": proposal(
    "The link from an accepted source report to its selected value is proposed.",
    "apps/web/src/HoldingImportOutcome.tsx",
  ),
  "source-updates-outcome": proposal(
    "The per-position value explanation is proposed. Keel already applies eligible updates to a followed GP total.",
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
  "This shortened GP source picker is proposed. Keel’s valuation editor supports choosing a price source for a position.",
  gp,
);
const gpHoldings = proposal(
  "This Holdings summary of GP source changes is proposed. Keel already distinguishes a followed price from a one-time estimate.",
  gp,
);

export function journeyStepStatus(id?: string): StepStatus | undefined {
  if (!id) return;
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
