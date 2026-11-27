import { CashHistoryWalkthrough } from "./cash-history-walkthrough";
import { AppAccessWalkthrough } from "./app-access-walkthrough";
import { SourceUpdatesWalkthrough } from "./source-updates-walkthrough";
import { ObligationsWalkthrough } from "./obligations-walkthrough";
import { WatchEvidenceWalkthrough } from "./watch-evidence-walkthrough";
import { EvidenceWalkthrough } from "./evidence-walkthrough";
import { PlanningWalkthrough } from "./planning-walkthrough";
import {
  ActionGroup,
  EmptyState,
  RecordItem,
  Screen,
  SectionHeader,
  TextLink,
} from "@keel/ui";
import { evidenceProposalRoute } from "./journey-status";
import { taskJourneys, taskSourceRevision } from "./task-journey-spec";

export function TaskJourney({ stepId }: { stepId: string }) {
  const journey = taskJourneys.find((item) =>
    item.steps.some((step) => step.id === stepId),
  );
  const step = journey?.steps.find((item) => item.id === stepId);
  if (!journey || !step)
    return (
      <EmptyState
        title="Step not found"
        actions={<TextLink href="#journeys">Return to Journeys</TextLink>}
      />
    );
  if (journey.id === "cash") {
    return (
      <Screen>
        <TextLink href="#journeys">All journeys</TextLink>
        <SectionHeader title={journey.title} />
        <CashHistoryWalkthrough />
      </Screen>
    );
  }
  const proposal = location.hash === "#journeys/" + evidenceProposalRoute;
  if (journey.id === "evidence") {
    return (
      <Screen>
        <TextLink href="#journeys">All journeys</TextLink>
        <SectionHeader
          title={proposal ? "Apply or ignore a reported value" : journey.title}
        />
        {proposal ? (
          <>
            <EvidenceWalkthrough stepId="evidence-proposal" />
            <TextLink href="#journeys/evidence-watch">
              Back to Watch capture
            </TextLink>
          </>
        ) : (
          <WatchEvidenceWalkthrough stepId={stepId} />
        )}
      </Screen>
    );
  }
  const index = journey.steps.indexOf(step);
  const sourceValueStep =
    journey.id === "source-updates" && stepId !== "source-updates-entities";
  return (
    <Screen>
      <TextLink href="#journeys">All journeys</TextLink>
      <SectionHeader
        title={
          sourceValueStep
            ? "What value does Keel use after this update?"
            : journey.title
        }
      />
      <p className="catalogue-note">
        {sourceValueStep
          ? "See what an accepted source report changed, and which value remains in use. Synthetic walkthrough."
          : journey.id === "obligations"
            ? "Review an obligation and its next-payment treatment. Synthetic walkthrough."
            : journey.id === "planning"
              ? "Edit a goal, save a version, then inspect its forecast record. Synthetic walkthrough."
              : journey.id === "app-access"
                ? "Inspect permissions and access lifetime. Synthetic read-only walkthrough."
                : "Source-backed current-state walkthrough · synthetic reference only. Links inspect the next reference screen; they do not perform the described product action."}
      </p>
      {!sourceValueStep &&
        journey.id !== "obligations" &&
        journey.id !== "app-access" && (
          <nav
            aria-label="Journey steps"
            className="catalogue-journey-navigation"
          >
            <ol>
              {journey.steps.map((item, i) => (
                <li key={item.id}>
                  <TextLink
                    href={`#journeys/${item.id}`}
                    aria-current={item.id === step.id ? "step" : undefined}
                  >
                    <span
                      className="catalogue-journey-step-number"
                      aria-hidden="true"
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>{item.title}</span>
                  </TextLink>
                </li>
              ))}
            </ol>
          </nav>
        )}
      {sourceValueStep ? (
        <SourceUpdatesWalkthrough stepId={stepId} />
      ) : journey.id === "app-access" ? (
        <AppAccessWalkthrough stepId={stepId} />
      ) : journey.id === "planning" ? (
        <PlanningWalkthrough stepId={stepId} />
      ) : journey.id === "obligations" ? (
        <ObligationsWalkthrough stepId={stepId} />
      ) : (
        <RecordItem
          title={step.title}
          detail={`Product route: ${step.route}`}
          metadata="Product route shown for orientation, not an external link"
        >
          <div className="catalogue-fact-values">
            <h4 className="candidate-source-heading">Action</h4>
            <p>{step.action}</p>
            <h4 className="candidate-source-heading">Result</h4>
            <p>{step.result}</p>
            <h4 className="candidate-source-heading">Context carried</h4>
            <p>{step.context}</p>
            <h4 className="candidate-source-heading">Alternate & boundary</h4>
            <p className="catalogue-note">{step.alternate}</p>
            <h4 className="candidate-source-heading">Source</h4>
            <p className="catalogue-note">
              {step.source} · {step.owner} Inspected revision{" "}
              {taskSourceRevision}. Source inspection, not a deployed visual
              audit.
            </p>
          </div>
        </RecordItem>
      )}
      {!sourceValueStep &&
        journey.id !== "planning" &&
        journey.id !== "obligations" &&
        journey.id !== "app-access" && (
          <ActionGroup wrap>
            {index > 0 && (
              <TextLink href={`#journeys/${journey.steps[index - 1]!.id}`}>
                Previous step
              </TextLink>
            )}
            {index < journey.steps.length - 1 ? (
              <TextLink href={`#journeys/${journey.steps[index + 1]!.id}`}>
                Inspect next: {journey.steps[index + 1]!.title}
              </TextLink>
            ) : (
              <TextLink href="#journeys">Back to journeys</TextLink>
            )}
          </ActionGroup>
        )}
      {!sourceValueStep &&
        journey.id !== "planning" &&
        journey.id !== "obligations" &&
        journey.id !== "app-access" && (
          <p className="catalogue-note">
            Reference controls:{" "}
            <TextLink href="#compositions?component=RecordItem">
              RecordItem
            </TextLink>{" "}
            · <TextLink href="#forms?component=TextLink">TextLink</TextLink>. No
            uploads, credentials, network calls or writes.
          </p>
        )}
    </Screen>
  );
}
