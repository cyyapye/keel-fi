import { TextLink } from "@keel/ui";
import { holdingMaintenanceJourney } from "./holding-maintenance-spec";
import { ManualHoldingWalkthrough } from "./manual-holding-walkthrough";
import { HoldingLinksWalkthrough } from "./holding-links-walkthrough";
import { HoldingCorrectionsWalkthrough } from "./holding-corrections-walkthrough";

export function HoldingMaintenanceWalkthrough({ stepId }: { stepId: string }) {
  return (
    <>
      <nav
        className="catalogue-journey-navigation"
        aria-label="Holding maintenance tasks"
      >
        <ol>
          {holdingMaintenanceJourney.steps.map((step) => (
            <li key={step.id}>
              <TextLink
                href={"#journeys/" + step.id}
                aria-current={step.id === stepId ? "step" : undefined}
              >
                {step.title}
              </TextLink>
            </li>
          ))}
        </ol>
      </nav>
      {stepId === "maintenance-manual" ? (
        <ManualHoldingWalkthrough route={location.hash} />
      ) : stepId === "maintenance-links" ? (
        <HoldingLinksWalkthrough />
      ) : (
        <HoldingCorrectionsWalkthrough terms={stepId === "maintenance-terms"} />
      )}
    </>
  );
}
