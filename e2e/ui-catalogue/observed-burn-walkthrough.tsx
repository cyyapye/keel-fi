import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Screen,
  SectionHeader,
  TextLink,
} from "@keel/ui";
import { useEffect, useRef, useState } from "react";

import { ObservedCashFlow } from "../../apps/web/src/ObservedCashFlow";
import { PlanActualMonitoring } from "../../apps/web/src/PlanActualMonitoring";
import { PlanInputsEditor } from "../../apps/web/src/PlanInputsEditor";
import type { CashFlowPlanSuggestion } from "../../packages/domain/src/index";
import { createObservedBurnExample } from "./observed-burn-fixture";

export function ObservedBurnWalkthrough() {
  const [example] = useState(createObservedBurnExample);
  const [screen, setScreen] = useState<"august" | "overview" | "november">(
    "august",
  );
  const [suggestion, setSuggestion] = useState<CashFlowPlanSuggestion | null>(
    null,
  );
  const [suggestionVersion, setSuggestionVersion] = useState(0);
  const [saves, setSaves] = useState(0);
  const screenRegion = useRef<HTMLElement>(null);
  useEffect(() => {
    if (screen !== "august") screenRegion.current?.focus();
  }, [screen]);
  const laterOverview = () => {
    example.openLaterObservation();
    setSuggestion(null);
    setScreen("overview");
  };
  const overview = screen === "overview";
  const area = overview ? "Overview" : "Scenarios";
  const comparisonBase = example.comparisonBase();
  return (
    <section aria-label={area + " capture"} ref={screenRegion} tabIndex={-1}>
      <Screen>
        <SectionHeader
          title={area}
          description={
            screen === "august"
              ? "Aug 15, 2026 · Synthetic observation"
              : "Nov 15, 2026 · Later reviewed observation"
          }
          descriptionPlacement="title-group"
        />
        {!overview && comparisonBase && (
          <p className="catalogue-note">
            Capture context · Compare burn uses version {comparisonBase.source}.
            Plan inputs show the current saved version {comparisonBase.saved}.
          </p>
        )}
        {overview ? (
          <PlanActualMonitoring
            requests={example.monitoringRequests}
            onNavigate={(route) => {
              if (route === "scenarios") setScreen("november");
            }}
          />
        ) : (
          <>
            {example.hasProposal() && (
              <ObservedCashFlow
                requests={example.cashFlowRequests}
                reloadKey={saves}
                onPreparePlanDraft={(next) => {
                  setSuggestion(next);
                  setSuggestionVersion((version) => version + 1);
                }}
              />
            )}
            <PlanInputsEditor
              requests={example.planRequests}
              suggestion={suggestion}
              suggestionVersion={suggestionVersion}
              onSaved={() => {
                setSuggestion(null);
                setSaves((count) => count + 1);
                return Promise.resolve();
              }}
            />
            {example.canOpenLaterObservation() && (
              <ActionGroup>
                <Button onClick={laterOverview}>
                  {screen === "august"
                    ? "Continue capture to the later Overview"
                    : "Return to the later Overview"}
                </Button>
              </ActionGroup>
            )}
          </>
        )}
        <Collapsible>
          <CollapsibleTrigger layout="inline">
            Capture controls and source <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="catalogue-note">
              The sample starts with May–July spending. Save the reviewed
              amounts to continue to Overview and compare the plan with
              August–October spending. In Keel, open Overview separately.
            </p>
            {overview && (
              <TextLink onClick={() => setScreen("november")}>
                Return to Scenarios
              </TextLink>
            )}
            <p className="catalogue-note">
              Product reference · Scenarios and Overview · ObservedCashFlow,
              PlanInputsEditor and PlanActualMonitoring at 32ee1909.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </Screen>
    </section>
  );
}
