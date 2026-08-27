import { AppShell, BrandMark, PageHeader, Screen } from "@keel/ui";

const navigation = [
  { id: "dashboard", index: "01", label: "Overview" },
  { id: "goals", index: "02", label: "Goals" },
  { id: "holdings", index: "03", label: "Holdings" },
  { id: "obligations", index: "04", label: "Obligations" },
  { id: "watch", index: "05", label: "Portfolio Watch" },
  { id: "evidence", index: "06", label: "Evidence Inbox" },
  { id: "scenarios", index: "07", label: "Scenarios" },
  { id: "history", index: "08", label: "Forecast History" },
] as const;

function HoldingsShell() {
  return (
    <AppShell
      activeItemId="holdings"
      brandMark={<BrandMark />}
      brandName="Keel"
      brandSubtitle="Private alpha"
      contextName="Portfolio"
      items={navigation}
      onNavigate={() => undefined}
      operatorInitials="DO"
      operatorName="Demo Operator"
      pageTitle="Holdings"
    >
      <Screen className="holdings-screen">
        <PageHeader
          description="See shared economic exposure, then open each legal position for ownership and source details."
          eyebrow="Portfolio evidence"
          title="Holdings"
        />
        <section
          aria-labelledby="investment-views-title"
          className="investment-views"
        >
          <div className="investment-views__heading">
            <div>
              <p className="eyebrow">Reviewed ownership</p>
              <h2 id="investment-views-title">Exposures</h2>
              <p>
                Legal positions stay separate inside each exposure. Open one for
                ownership and source details.
              </p>
            </div>
          </div>
          <p className="investment-views__loading" role="status">
            Loading reviewed exposures…
          </p>
        </section>
      </Screen>
    </AppShell>
  );
}

export function InitialShell() {
  if (/^\/holdings(?:\/|$)/u.test(window.location.pathname)) {
    return <HoldingsShell />;
  }
  return (
    <div className="loading-shell">
      <div className="loading-brand">Keel</div>
      <div aria-live="polite" className="loading-card" role="status">
        <span aria-hidden="true" className="loader" />
        <h1>Loading your portfolio</h1>
      </div>
    </div>
  );
}
