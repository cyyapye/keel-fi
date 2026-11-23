import { formatHoldingsAmount } from "@keel/ui/money";
import { HoldingsTotalJourney } from "./holdings-total-journey";
import { startIpoWalkthrough } from "./ipo-watch-journey";
import { ValuationJourney } from "./closing-price-journey";
import { valuationRoute } from "./valuation-scenarios";
import { TaskJourney } from "./task-journeys";
import { taskJourneys } from "./task-journey-spec";
import { DetailLink } from "./detail-link";
import { useState } from "react";
import {
  ActionGroup,
  Button,
  ButtonLink,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  Field,
  RecordGroup,
  RecordItem,
  RecordRow,
  Screen,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatGroup,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  TextLink,
} from "@keel/ui";
import { areas, componentPage, steps, type StepId } from "./journey-spec";

const href = (id: StepId) => `#journeys/${id}`;
function Back() {
  return <TextLink href={href("company")}>Back to holdings</TextLink>;
}
export function Journeys({ stepId }: { stepId?: string | undefined }) {
  const [scenario, setScenario] = useState("ordinary");
  const [account, setAccount] = useState(false);
  const step = steps.find((item) => item.id === stepId);
  const valuation = valuationRoute(stepId);
  if (stepId === "holdings-total")
    return <HoldingsTotalJourney view="holdings" />;
  if (stepId === "holdings-total-position")
    return <HoldingsTotalJourney view="position" />;
  if (stepId === "holdings-total-valuation")
    return <HoldingsTotalJourney view="valuation" />;
  if (valuation)
    return <ValuationJourney key={valuation.scenario} {...valuation} />;
  if (
    stepId &&
    taskJourneys.some((journey) =>
      journey.steps.some((item) => item.id === stepId),
    )
  )
    return <TaskJourney stepId={stepId} />;
  if (stepId && !step)
    return (
      <EmptyState
        title="Step not found"

        actions={<TextLink href="#journeys">Return to Journeys</TextLink>}
      />
    );
  if (!step)
    return (
      <Screen>
        <p>
          See how Keel fits together, then inspect one path across screens and
          components.
        </p>
        <section className="catalogue-example">
          <SectionHeader title="What do I own in this company?" />
          <p>
            Start with portfolio exposure, open an account position, inspect
            reported activity and lots, and return to the company context.
          </p>
          <TextLink href={href("portfolio")}>Inspect the journey</TextLink>
          <p className="catalogue-note">
            Synthetic screen abstractions. Source-backed behavior, not a live
            visual audit. A standalone company workspace is not shipped.
          </p>
        </section>
        <section className="catalogue-example">
          <SectionHeader title="When do I need to review a valuation?" />
          <p>
            Explore an IPO, separate GP marks, and followed or one-time proxy
            estimates from Holdings.
          </p>
          <ActionGroup wrap>
            <ButtonLink href="#journeys/closing-price">
              Start from Holdings
            </ButtonLink>
            <TextLink
              href="#journeys/closing-price-watch"
              onClick={startIpoWalkthrough}
            >
              Start from Portfolio Watch
            </TextLink>
          </ActionGroup>
        </section>
        <section className="catalogue-example">
          <SectionHeader title="What counts toward my holdings total?" />
          <p>
            Trace a fund through its underlying exposures and value a position
            from new evidence.
          </p>
          <TextLink href="#journeys/holdings-total">
            Reconcile holdings
          </TextLink>
        </section>
        {taskJourneys.map((journey) => (
          <section className="catalogue-example" key={journey.id}>
            <SectionHeader title={journey.title} />
            <p>{journey.steps.map((item) => item.title).join(" → ")}</p>
            <TextLink href={`#journeys/${journey.steps[0]!.id}`}>
              Inspect the journey
            </TextLink>
            <p className="catalogue-note">
              {journey.id === "planning"
                ? "Interactive demo · synthetic goal editing and saved-version flow."
                : "Read-only walkthrough · actual routes and in-memory boundaries identified."}
            </p>
          </section>
        ))}
        <SectionHeader title="Browse by area" />
        <p className="catalogue-note">
          Inspect separate user tasks, not one forced chain. Overview → Holdings
          remains the detailed synthetic ownership example. Additional paths are
          source-backed walkthroughs, not interactive product simulations.
        </p>
        <div className="catalogue-grid">
          {areas.map(([id, title, description]) => (
            <section key={id} aria-label={`${title} area`}>
              <SectionHeader title={title} />
              <p>{description}</p>
              <p className="catalogue-note">
                {id === "overview" ||
                id === "holdings" ||
                taskJourneys.some((journey) => journey.areas.includes(id))
                  ? "Selected path inspected in source"
                  : "Orientation only · navigation label verified"}
              </p>
              {id === "holdings" && (
                <p className="catalogue-note">
                  Holdings · Legal entities · Sources
                </p>
              )}
              <ActionGroup wrap>
                {(id === "overview" || id === "holdings") && (
                  <TextLink href={href("portfolio")}>
                    Company ownership journey
                  </TextLink>
                )}
                {id === "holdings" && (
                  <TextLink href="#journeys/closing-price">
                    Valuation sources
                  </TextLink>
                )}
                {id === "holdings" && (
                  <TextLink href="#journeys/holdings-total">
                    Reconcile holdings
                  </TextLink>
                )}
                {id === "watch" && (
                  <TextLink href="#journeys/closing-price-watch">
                    IPO filing to first close
                  </TextLink>
                )}
                {taskJourneys
                  .filter((journey) => journey.areas.includes(id))
                  .map((journey) => (
                    <TextLink
                      key={journey.id}
                      href={`#journeys/${journey.steps[0]!.id}`}
                    >
                      {journey.title}
                    </TextLink>
                  ))}
              </ActionGroup>
            </section>
          ))}
        </div>
      </Screen>
    );
  const index = steps.indexOf(step);
  return (
    <Screen>
      <TextLink href="#journeys">All journeys</TextLink>
      <nav aria-label="Journey steps" className="catalogue-journey-navigation">
        <ol>
          {steps.map((item, i) => (
            <li key={item.id}>
              <TextLink
                href={href(item.id)}
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
      <Field label="Scenario">
        <Select
          value={scenario}
          onValueChange={(value) =>
            setScenario(typeof value === "string" ? value : "ordinary")
          }
        >
          <SelectTrigger aria-label="Scenario">
            <SelectValue>
              {scenario === "missing"
                ? "No reported lots"
                : "Reported lots · incomplete timing"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ordinary">
              Reported lots · incomplete timing
            </SelectItem>
            <SelectItem value="missing">No reported lots</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <section
        className="catalogue-example catalogue-stack"
        aria-label="Synthetic screen preview"
      >
        {step.id === "portfolio" && (
          <>
            <SectionHeader title="Portfolio" />
            <StatGroup>
              <Stat
                label="Synthetic reviewed value · USD"
                value={formatHoldingsAmount(12_000_000)}
              />
            </StatGroup>
            <RecordItem
              className="catalogue-drill-in-row"
              title="Northstar Robotics"
              detail={`${formatHoldingsAmount(3_000_000)} across 2 positions`}
              action={
                <DetailLink
                  href={href("company")}
                  label="View Northstar Robotics exposure"
                />
              }
            />
          </>
        )}
        {step.id === "company" && (
          <>
            <SectionHeader title="Northstar Robotics" />
            <p>
              {formatHoldingsAmount(3_000_000)} total · independent account
              positions
            </p>
            <RecordGroup className="catalogue-company-positions">
              <RecordRow
                title="Brokerage A"
                detail="100 shares"
                value={formatHoldingsAmount(2_000_000)}
                action={
                  <DetailLink href={href("position")} label="Open position" />
                }
              />
              <RecordRow
                title="Brokerage B"
                detail="50 shares"
                value={formatHoldingsAmount(1_000_000)}
                metadata="Context only"
              />
            </RecordGroup>
            <p className="catalogue-note">
              An expanded exposure group within Holdings, not a dedicated
              company workspace.
            </p>
          </>
        )}
        {step.id === "position" && (
          <>
            <Back />
            <SectionHeader title="Northstar Robotics" />
            <p>Brokerage A · holding position</p>
            <StatGroup>
              <Stat
                label="Reported market value"
                value="$20,000.00"
                detail="100 shares"
              />
            </StatGroup>
            <p className="catalogue-note">
              Synthetic brokerage observation · 14 November 2026. Current
              ownership is separate from history.
            </p>
            <ActionGroup wrap>
              <TextLink href={href("activity")}>Activity</TextLink>
              <TextLink href={href("lots")}>Tax lots</TextLink>
            </ActionGroup>
          </>
        )}
        {(step.id === "activity" || step.id === "lots") && (
          <>
            <Back />
            <SectionHeader title="Investment history" />
            <p>
              {account && step.id === "activity"
                ? "Brokerage A · account scope"
                : "Northstar Robotics · Brokerage A · position scope"}
            </p>
            {step.id === "activity" && (
              <Button tone="quiet" onClick={() => setAccount(!account)}>
                {account ? "Position activity" : "Account activity"}
              </Button>
            )}
            <Tabs
              value={step.id}
              onValueChange={(value) => {
                if (value === "activity" || value === "lots")
                  location.hash = `journeys/${value}`;
              }}
            >
              <TabsList aria-label="Investment history views">
                <TabsTrigger value="activity">Activity</TabsTrigger>
                {!(account && step.id === "activity") && (
                  <TabsTrigger value="lots">Tax lots</TabsTrigger>
                )}
              </TabsList>
              <TabsContent value="activity">
                <p className="catalogue-note">
                  Reported history only. Does not change current position value.
                </p>
                <RecordItem
                  title="Buy · Northstar Robotics"
                  detail="10 shares · $1,800 paid"
                  metadata="8 November 2026 · synthetic broker record"
                >
                  <div>
                    <h4 className="candidate-source-heading">Source</h4>
                    <p className="catalogue-note">
                      Fixture brokerage observation. Capture date is not the
                      trade date. One reported event, not lifetime history.
                    </p>
                  </div>
                </RecordItem>
                {account && (
                  <p className="catalogue-note">
                    Account activity has no Tax lots tab. Return to Position
                    activity to inspect lots.
                  </p>
                )}
              </TabsContent>
              <TabsContent value="lots">
                <p className="catalogue-note">
                  Reported remaining lots, not reconstructed history. Not a
                  tax-lot election or tax advice.
                </p>
                {scenario === "missing" ? (
                  <EmptyState
                    title="No reported lots available"
                    children="The source has not provided lot records. This does not mean zero holdings or zero basis. Current position remains 100 shares."
                  />
                ) : (
                  <>
                    <RecordItem
                      title="Remaining lot · 100 shares"
                      detail="$15,000 reported basis"
                      metadata="Synthetic fixture · acquisition detail incomplete"
                    />
                    <p className="catalogue-note">
                      Quantity matches this fixture’s current shares; timing
                      coverage is incomplete, so inclusion is not established.
                    </p>
                  </>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </section>
      <div className="catalogue-grid">
        <section>
          <SectionHeader title="Action and result" />
          <p>
            <strong>Trigger:</strong> {step.trigger}
          </p>
          <p>
            <strong>Result:</strong> {step.result}
          </p>
          <p>
            <strong>Context:</strong> {step.context}
          </p>
        </section>
        <section>
          <SectionHeader title="Components used" />
          <ActionGroup wrap>
            {step.components.map((name) => (
              <TextLink
                key={name}
                href={`#${componentPage(name)}?component=${name}`}
              >
                {name}
              </TextLink>
            ))}
          </ActionGroup>
          <p className="catalogue-note">
            Shared components render this abstraction. These links open their
            existing catalogue examples.
          </p>
        </section>
      </div>
      <Collapsible>
        <CollapsibleTrigger>
          Shipped versus proposed · source and limits
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="catalogue-note">
            Source reference 06e63a7 · {step.source}. Exposure and position use
            Holdings query parameters; Activity and Tax lots use local state.
            Account activity hides lots.
          </p>
          <p className="catalogue-note">
            This reference navigator, reverse component index and context
            annotations are new. Its URLs are catalogue references, not
            production tab deep links. Exact production focus/scroll restoration
            still needs live verification. Read-only synthetic examples; saving,
            failed-save and editing states do not apply.
          </p>
        </CollapsibleContent>
      </Collapsible>
      <ActionGroup wrap>
        {index > 0 && (
          <TextLink href={href(steps[index - 1]!.id)}>Previous step</TextLink>
        )}
        {index < steps.length - 1 ? (
          <TextLink href={href(steps[index + 1]!.id)}>Next step</TextLink>
        ) : (
          <TextLink href={href("company")}>Recover company context</TextLink>
        )}
      </ActionGroup>
    </Screen>
  );
}
