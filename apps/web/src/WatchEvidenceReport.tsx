import { useState } from "react";
import type {
  AlphaData,
  EvidenceInboxItem,
  PublicSourceObservation,
  SignalReconciliationGroup,
} from "@keel/domain";
import {
  ActionGroup,
  Badge,
  Button,
  ButtonLink,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Notice,
  TextLink,
} from "@keel/ui";
import { WatchFilingRow } from "./WatchFilingRow";
import { formatCompactMoney, formatDate, formatProbability } from "./format";
import {
  type FinancingFacts,
  financingRoundLabel,
  financingAmbiguityLabel,
  financingAmountLabel,
  financingValuationBasisLabel,
  financingScenarioTermsLabel,
  financingSourceExcerpt,
} from "./financing-report-format";
import { formatWatchTime } from "./portfolio-watch-format";

function sourceClassLabel(sourceClass: PublicSourceObservation["sourceClass"]) {
  return {
    official_company: "Official company",
    regulatory_filing: "Regulatory filing",
    reputable_reporting: "Named reporting",
    secondary_source: "Secondary source",
  }[sourceClass];
}

function sourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return sourceUrl;
  }
}

function FinancingAmbiguities({ facts }: { facts: FinancingFacts }) {
  if (facts.ambiguities.length === 0) {
    return null;
  }

  return (
    <small className="financing-ambiguity">
      Check source wording:{" "}
      {facts.ambiguities.map(financingAmbiguityLabel).join(", ")}
    </small>
  );
}

function ReportedFinancingTerms({
  facts,
  sourceExcerpt,
}: {
  facts: FinancingFacts;
  sourceExcerpt?: string | null;
}) {
  const displayedExcerpt =
    sourceExcerpt ??
    facts.announcedAmount?.evidenceText ??
    facts.companyValuation?.evidenceText ??
    null;
  return (
    <div className="reported-financing-terms">
      <span>Reported financing</span>
      <strong>{financingRoundLabel(facts)}</strong>
      {facts.announcedAmount !== null && (
        <div>
          <b>{financingAmountLabel(facts.announcedAmount)}</b>
        </div>
      )}
      {facts.companyValuation !== null && (
        <div>
          <b>
            {financingAmountLabel(facts.companyValuation)} ·{" "}
            {financingValuationBasisLabel(facts.companyValuation)}
          </b>
        </div>
      )}
      {displayedExcerpt !== null && (
        <small className="financing-source-excerpt">
          Source wording: “{displayedExcerpt}”
        </small>
      )}
      <FinancingAmbiguities facts={facts} />
    </div>
  );
}

export function WatchNewsRow({
  observation,
  sourceHref = observation.sourceUrl,
  needsDecision,
  onReview,
  onRead,
}: {
  observation: AlphaData["portfolioWatch"]["observations"][number];
  sourceHref?: string | undefined;
  needsDecision: boolean;
  onReview: (eventId: string) => void;
  onRead: (id: string, read: boolean, version: number) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unread = observation.readAt == null;
  const readAction = (
    <Button
      tone="quiet"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        setError(null);
        void onRead(observation.id, unread, observation.readVersion ?? 0)
          .catch((caught: unknown) =>
            setError(
              caught instanceof Error
                ? caught.message
                : "Couldn’t save read status.",
            ),
          )
          .finally(() => setBusy(false));
      }}
    >
      {busy ? "Saving…" : unread ? "Mark read" : "Mark unread"}
    </Button>
  );
  if (observation.eventType === "public_listing_announced" && !needsDecision) {
    return (
      <WatchFilingRow
        title={observation.sourceTitle}
        href={sourceHref}
        metadata={
          <>
            {observation.companyName} · {sourceHost(observation.sourceUrl)} ·{" "}
            <time
              dateTime={observation.publishedAt}
              title={`Found ${formatWatchTime(observation.retrievedAt)}`}
            >
              {formatDate(observation.publishedAt.slice(0, 10))}
            </time>
          </>
        }
        action={readAction}
      >
        {error !== null && <Notice tone="error">{error}</Notice>}
      </WatchFilingRow>
    );
  }
  const fullSummary =
    observation.financingFacts === null
      ? observation.observedFact.trim()
      : financingScenarioTermsLabel(observation.financingFacts);
  const summary =
    fullSummary.length > 240
      ? fullSummary.slice(0, 240).replace(/\s+\S*$/, "") + "…"
      : fullSummary;
  return (
    <article className="watch-news-row" aria-label={observation.sourceTitle}>
      <div className="watch-news-content">
        <p className="watch-news-meta">
          <strong>{observation.companyName}</strong> ·{" "}
          {sourceHost(observation.sourceUrl)}
          {needsDecision && (
            <span className="watch-decision-label">Decision needed</span>
          )}
        </p>
        <h3>
          <ButtonLink
            href={sourceHref}
            target="_blank"
            rel="noreferrer"
            tone="plain"
          >
            {observation.sourceTitle}
          </ButtonLink>
        </h3>
        {fullSummary !== observation.sourceTitle.trim() && (
          <p className="watch-news-summary">{summary}</p>
        )}
        <p className="watch-news-dates">
          Published{" "}
          {observation.publishedAt === null
            ? "date unavailable"
            : formatWatchTime(observation.publishedAt)}{" "}
          · Found {formatWatchTime(observation.retrievedAt)}
        </p>
        <Collapsible>
          <CollapsibleTrigger className="watch-news-details-trigger">
            Details <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent className="watch-news-details">
            <p>
              {sourceClassLabel(observation.sourceClass)} ·{" "}
              {sourceHost(observation.sourceUrl)}
            </p>
            {observation.financingFacts !== null && (
              <ReportedFinancingTerms
                facts={observation.financingFacts}
                sourceExcerpt={financingSourceExcerpt(
                  observation.financingFacts,
                  observation.observedFact,
                )}
              />
            )}
            {observation.financingFacts !== null && (
              <p>{observation.inference}</p>
            )}
            {observation.financingFacts === null &&
              observation.valuationLowMinor !== null &&
              observation.valuationMiddleMinor !== null &&
              observation.valuationHighMinor !== null && (
                <p>
                  <strong>Estimated range</strong>{" "}
                  {formatCompactMoney(observation.valuationLowMinor)} –{" "}
                  {formatCompactMoney(observation.valuationHighMinor)}
                </p>
              )}
            <p>{observation.limitations}</p>
            <Button
              tone="quiet"
              onClick={() => onReview(observation.evidenceEventId)}
            >
              View evidence
            </Button>
          </CollapsibleContent>
        </Collapsible>
        {error !== null && <Notice tone="error">{error}</Notice>}
      </div>
      <ActionGroup className="watch-news-actions" wrap>
        {needsDecision && (
          <Button onClick={() => onReview(observation.evidenceEventId)}>
            Review decision
          </Button>
        )}
        {readAction}
      </ActionGroup>
    </article>
  );
}

export function EvidenceCard({
  busy,
  item,
  sourceHref,
  onApply,
  onReview,
  reconciliation,
}: {
  busy: boolean;
  item: EvidenceInboxItem;
  sourceHref?: string | undefined;
  onApply: (eventId: string) => void;
  onReview: (
    eventId: string,
    decision: "accepted" | "rejected" | "scenario_only",
  ) => void;
  reconciliation?: {
    relationship: SignalReconciliationGroup["reports"][number]["relationship"];
    reviewOrder: number;
  };
}) {
  const pending = item.status === "pending_review";
  const reviewable = pending && reconciliation?.relationship !== "superseded";
  const application = item.financingFacts === null ? item.application : null;
  const canApply =
    item.financingFacts === null &&
    item.status === "accepted" &&
    application !== null &&
    !application.applied;
  const [showAcceptPreview, setShowAcceptPreview] = useState(false);
  const statusLabel = application?.applied
    ? "accepted & applied"
    : item.status.replaceAll("_", " ");
  return (
    <article className="evidence-card" id={`evidence-${item.id}`} tabIndex={-1}>
      <header>
        <div className="evidence-icon">E</div>
        <div>
          {reconciliation !== undefined && (
            <p className="evidence-reconciliation-order">
              Report {reconciliation.reviewOrder} ·{" "}
              {
                {
                  corroborating: "Corroborates",
                  conflicting: "Conflicts",
                  superseded: "Superseded",
                  unconfirmed: "Unconfirmed",
                }[reconciliation.relationship]
              }
            </p>
          )}
          <p className="eyebrow">
            {item.companyName} · {item.eventType.replaceAll("_", " ")}
          </p>
          <h2>{item.headline}</h2>
        </div>
        <Badge tone={pending ? "accent" : "neutral"}>{statusLabel}</Badge>
      </header>
      <div className="evidence-body">
        <div className="evidence-sources">
          <span>Supporting source</span>
          {item.sources.map((source) => (
            <strong key={source}>▣ {source}</strong>
          ))}
          {item.sourceUrl !== null && (
            <TextLink
              className="evidence-source-link"
              href={sourceHref ?? item.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open official source
            </TextLink>
          )}
          <small>
            Effective {formatDate(item.effectiveDate)} · Retrieved{" "}
            {formatDate(item.detectedAt)}
          </small>
          {item.financingFacts !== null && (
            <small>
              {formatProbability(item.confidencePpm)} source reliability
              {item.modelConfidencePpm === null
                ? ""
                : ` · ${formatProbability(item.modelConfidencePpm)} classification confidence`}
            </small>
          )}
        </div>
        {item.financingFacts === null ? (
          <>
            <div className="proposed-change">
              <span>Proposed change</span>
              <div>
                <del>{item.priorValue}</del>
                <i>→</i>
                <ins>{item.replacementValue}</ins>
              </div>
              <small>
                {item.modelConfidencePpm === null
                  ? `${formatProbability(item.confidencePpm)} source confidence`
                  : `${formatProbability(item.confidencePpm)} source reliability · ${formatProbability(item.modelConfidencePpm)} model confidence`}
              </small>
            </div>
            <div className="forecast-impact">
              <span title="50th-percentile estimate">
                Estimated middle-outcome impact
              </span>
              <strong>
                {item.forecastImpactMinor >= 0 ? "+" : ""}
                {formatCompactMoney(item.forecastImpactMinor)}
              </strong>
              <small>Applied only after a new snapshot is created</small>
            </div>
          </>
        ) : (
          <>
            <ReportedFinancingTerms
              facts={item.financingFacts}
              sourceExcerpt={item.sourceExcerpt}
            />
            <div className="holding-impact-boundary">
              <span>Holding impact</span>
              <strong>Not calculated</strong>
              <small>Company terms do not set this holding’s value.</small>
            </div>
          </>
        )}
      </div>
      {(item.financingFacts === null || reviewable) && (
        <footer
          className={
            item.financingFacts === null ? undefined : "financing-review-footer"
          }
        >
          {item.financingFacts === null && (
            <p>
              {application?.applied
                ? `Accepted and applied to ${application.label}.`
                : "A review preserves both values. Applying updates only the mapped accepted record; scenario-only keeps the proposal out of it."}
            </p>
          )}
          {showAcceptPreview && (reviewable || canApply) ? (
            <div className="evidence-apply-preview">
              <div>
                <span>
                  {application === null
                    ? "Accept as reviewed evidence"
                    : "Apply to accepted record"}
                </span>
                {application === null ? (
                  <p>
                    {item.financingFacts === null
                      ? "This proposal has no financial record target yet. Accepting records the evidence without applying a value."
                      : `Record ${financingRoundLabel(item.financingFacts)} as reviewed company evidence.`}
                  </p>
                ) : (
                  <p>
                    Update {application.label}: {item.priorValue} →{" "}
                    {item.replacementValue}
                  </p>
                )}
                <small>
                  {item.financingFacts !== null
                    ? "No holding mark or forecast changes."
                    : item.application === null
                      ? "Use Scenario only to model its impact."
                      : "Creates an accepted mark on the effective date; forecast impact still requires a new snapshot."}
                </small>
              </div>
              <div>
                {application !== null && (
                  <Button
                    disabled={busy}
                    onClick={() => onApply(item.id)}
                    tone="primary"
                  >
                    Confirm & apply
                  </Button>
                )}
                {reviewable && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setShowAcceptPreview(false);
                      onReview(item.id, "accepted");
                    }}
                    tone={application === null ? "primary" : "quiet"}
                  >
                    {application === null
                      ? "Accept evidence"
                      : "Accept without applying"}
                  </Button>
                )}
                <Button
                  disabled={busy}
                  onClick={() => setShowAcceptPreview(false)}
                  tone="quiet"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : canApply ? (
            <div>
              <Button
                disabled={busy}
                onClick={() => setShowAcceptPreview(true)}
                tone="primary"
              >
                Apply accepted evidence
              </Button>
            </div>
          ) : (
            <div>
              <Button
                disabled={!reviewable || busy}
                onClick={() => onReview(item.id, "rejected")}
                tone="quiet"
              >
                Reject
              </Button>
              <Button
                disabled={!reviewable || busy}
                onClick={() => onReview(item.id, "scenario_only")}
              >
                Scenario only
              </Button>
              <Button
                disabled={!reviewable || busy}
                onClick={() => setShowAcceptPreview(true)}
                tone="primary"
              >
                Accept evidence
              </Button>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}
