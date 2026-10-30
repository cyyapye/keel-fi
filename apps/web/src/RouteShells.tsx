import {
  AppShell,
  BrandMark,
  FormMessage,
  PageHeader,
  Screen,
  SectionHeader,
  TextLink,
} from "@keel/ui";
import type { ReactNode } from "react";

import {
  holdingsNavigation,
  referenceLinks,
  type HoldingsView,
  navigation,
  pageHeading,
} from "./app-navigation";

export function HoldingsNavigation({
  view,
  onNavigate,
}: {
  view: HoldingsView;
  onNavigate?: (view: HoldingsView) => void;
}) {
  return (
    <nav aria-label="Holdings sections" className="holdings-navigation">
      {holdingsNavigation.map((item) => (
        <TextLink
          key={item.id}
          href={item.path}
          aria-current={view === item.id ? "page" : undefined}
          onClick={(event) => {
            if (
              !onNavigate ||
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onNavigate(item.id);
          }}
        >
          {item.label}
        </TextLink>
      ))}
    </nav>
  );
}

export function LoadingShell() {
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

export function HoldingsRouteShell({ status }: { status?: ReactNode }) {
  return (
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
        <SectionHeader
          className="investment-views__heading"
          description="Legal positions stay separate inside each exposure."
          descriptionPlacement="title-group"
          eyebrow="Reviewed ownership"
          headingProps={{ id: "investment-views-title" }}
          title="Exposures"
        />
        {status ?? (
          <FormMessage className="investment-views__loading">
            Loading reviewed exposures…
          </FormMessage>
        )}
      </section>
    </Screen>
  );
}

export function HoldingsInitialShell() {
  return (
    <AppShell
      referenceLinks={referenceLinks}
      activeItemId="holdings"
      brandMark={<BrandMark />}
      brandName="Keel"
      brandSubtitle="Private alpha"
      contextName="Portfolio"
      items={navigation}
      onNavigate={() => undefined}
      operatorInitials="DO"
      operatorName="Demo Operator"
      pageTitle={pageHeading("holdings")}
    >
      <HoldingsNavigation
        view={
          holdingsNavigation.find(
            (item) => item.path === window.location.pathname,
          )?.id ?? "overview"
        }
      />
      <HoldingsRouteShell />
    </AppShell>
  );
}
