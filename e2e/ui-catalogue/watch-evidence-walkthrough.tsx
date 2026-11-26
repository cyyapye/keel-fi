import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  ActionGroup,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  EmptyState,
  Notice,
  PageHeader,
  SectionHeader,
  TextLink,
} from "@keel/ui";
import type { EvidenceInboxItem } from "../../packages/domain/src/index";
import { financingScenarioTermsLabel } from "../../apps/web/src/financing-report-format";
import {
  EvidenceCard,
  WatchNewsRow,
} from "../../apps/web/src/WatchEvidenceReport";
import { formatCompactMoney } from "../../apps/web/src/format";
import { evidenceProposalRoute } from "./journey-status";
import { inboxReports, watchObservations } from "./watch-evidence-reports";

const savedKey = "keel-catalogue-watch-evidence-v1";
const reviewState = z.enum([
  "accepted",
  "rejected",
  "scenario_only",
  "applied",
]);
const progressSchema = z.object({
  decisions: z.record(z.string(), reviewState),
  read: z.array(z.string()),
});
type Progress = z.infer<typeof progressSchema>;
const empty: Progress = { decisions: {}, read: [] };
function readProgress(): Progress {
  try {
    return progressSchema.parse(
      JSON.parse(sessionStorage.getItem(savedKey) ?? "null"),
    );
  } catch {
    return empty;
  }
}

const watchHref = "#journeys/evidence-watch";
const inboxHref = "#journeys/evidence-review";
const scenarioHref = "#journeys/evidence-scenario";
function openReport(id: string) {
  location.hash = inboxHref + "/" + encodeURIComponent(id);
}

function WatchUpdates({
  progress,
  sourceLinks,
  onRead,
}: {
  progress: Progress;
  sourceLinks: ReadonlyMap<string, string>;
  onRead: (observation: string, read: boolean) => Promise<void>;
}) {
  const [filter, setFilter] = useState("unread");
  const unread = watchObservations.filter(
    (row) => !progress.read.includes(row.id),
  );
  const decisions = watchObservations.filter(
    (row) => row.financingFacts && !progress.decisions[row.evidenceEventId],
  );
  const visible =
    filter === "unread"
      ? unread
      : filter === "decisions"
        ? decisions
        : watchObservations;
  return (
    <section className="watch-screen" aria-label="Watch updates">
      <PageHeader
        title="Portfolio Watch"
        description="Public news and updates for your private holdings."
      />
      <SectionHeader
        className="watch-updates-heading"
        title={
          filter === "unread"
            ? "Unread news"
            : filter === "decisions"
              ? "Decisions needed"
              : "All updates"
        }
        action={
          <ActionGroup aria-label="Filter updates" role="group" wrap>
            {(
              [
                ["unread", `Unread (${unread.length})`],
                ["decisions", `Decisions (${decisions.length})`],
                ["all", "All updates"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                size="compact"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </Button>
            ))}
          </ActionGroup>
        }
      />
      {visible.length ? (
        <div className="watch-news-list">
          {visible.map((row) => (
            <WatchNewsRow
              key={row.id}
              observation={{
                ...row,
                readAt: progress.read.includes(row.id) ? row.retrievedAt : null,
              }}
              sourceHref={sourceLinks.get(row.evidenceEventId)}
              needsDecision={decisions.includes(row)}
              onReview={openReport}
              onRead={onRead}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          title={
            filter === "unread" ? "No unread updates" : "No decisions needed"
          }
        />
      )}
      <p className="catalogue-note">
        Reading news does not change a holding. Financial changes have their own
        review.
      </p>
    </section>
  );
}

export function WatchEvidenceWalkthrough({ stepId }: { stepId: string }) {
  const [progress, setProgress] = useState(readProgress);
  // The real controls link to an official source in another tab. Supply a
  // local facsimile for each synthetic URL so inspecting a source also works offline.
  const [sourceLinks] = useState(
    () =>
      new Map(
        watchObservations.map((row) => [
          row.evidenceEventId,
          URL.createObjectURL(
            new Blob(
              [
                [
                  row.companyName,
                  row.sourceTitle,
                  row.publishedAt.slice(0, 10),
                  row.observedFact,
                  "Synthetic source for the Keel catalogue.",
                ].join("\n\n"),
              ],
              { type: "text/plain;charset=utf-8" },
            ),
          ),
        ]),
      ),
  );
  useEffect(
    () => () => {
      for (const href of sourceLinks.values()) URL.revokeObjectURL(href);
    },
    [sourceLinks],
  );
  const [scenario, setScenario] = useState<EvidenceInboxItem | null>(null);
  const [busy, setBusy] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [failNext, setFailNext] = useState(false);
  const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const selectedId = location.hash.split("/")[2] ?? null;
  const watch = stepId === "evidence-watch";
  const inbox = stepId === "evidence-review";
  useEffect(() => {
    try {
      sessionStorage.setItem(savedKey, JSON.stringify(progress));
    } catch {
      /* Tab storage is optional. */
    }
  }, [progress]);
  useEffect(() => {
    const timers = pending.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (!inbox || !selectedId) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById("evidence-" + selectedId);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: "start" });
    });
    return () => cancelAnimationFrame(frame);
  }, [inbox, selectedId]);
  function decide(id: string, decision: z.infer<typeof reviewState>) {
    if (pending.current.has(id)) return;
    const item = inboxReports.find((report) => report.id === id);
    if (!item) return;
    setBusy((previous) => [...previous, id]);
    setError(null);
    if (failNext) setFailNext(false);
    const timer = setTimeout(() => {
      pending.current.delete(id);
      setBusy((previous) => previous.filter((eventId) => eventId !== id));
      if (failNext) {
        setError(
          decision === "applied"
            ? "Evidence application could not be recorded."
            : "Evidence review returned 503.",
        );
        return;
      }
      setProgress((previous) => ({
        ...previous,
        decisions: { ...previous.decisions, [id]: decision },
      }));
      if (decision === "scenario_only") {
        setScenario(item);
        location.hash = scenarioHref;
      }
    }, 250);
    pending.current.set(id, timer);
  }
  const reports = inboxReports.map((item): EvidenceInboxItem => {
    const decision = progress.decisions[item.id];
    return {
      ...item,
      status: decision === "applied" ? "accepted" : (decision ?? item.status),
      application: item.application && {
        ...item.application,
        applied: decision === "applied",
      },
    };
  });
  return (
    <div className="catalogue-stack catalogue-watch-evidence">
      <nav aria-label="Captured screens">
        <ActionGroup wrap>
          <TextLink href={watchHref} aria-current={watch ? "page" : undefined}>
            Portfolio Watch
          </TextLink>
          <TextLink href={inboxHref} aria-current={inbox ? "page" : undefined}>
            Evidence Inbox
          </TextLink>
        </ActionGroup>
      </nav>
      {watch ? (
        <WatchUpdates
          progress={progress}
          sourceLinks={sourceLinks}
          onRead={(id, read) => {
            setProgress((previous) => ({
              ...previous,
              read: read
                ? [...new Set([...previous.read, id])]
                : previous.read.filter((value) => value !== id),
            }));
            return Promise.resolve();
          }}
        />
      ) : inbox ? (
        <section className="evidence-screen" aria-label="Report review">
          <PageHeader
            eyebrow="Review before change"
            title="Evidence Inbox"
            description="External signals become proposals. You decide what enters the accepted record or a scenario."
            actions={
              <Badge tone="accent">
                {
                  reports.filter((item) => item.status === "pending_review")
                    .length
                }{" "}
                pending
              </Badge>
            }
          />
          {selectedId && !reports.some((item) => item.id === selectedId) && (
            <Notice tone="error">
              This update is no longer available in the inbox.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <div className="evidence-list">
            {reports.map((item) => (
              <EvidenceCard
                key={item.id}
                item={item}
                sourceHref={sourceLinks.get(item.id)}
                busy={busy.includes(item.id)}
                onReview={decide}
                onApply={(id) => decide(id, "applied")}
              />
            ))}
          </div>
        </section>
      ) : (
        <section aria-label="Scenario workspace excerpt">
          <PageHeader title="Scenarios" />
          {scenario ? (
            <div className="scenario-context" role="status">
              <div>
                <p className="eyebrow">
                  {scenario.financingFacts
                    ? "Reported financing context"
                    : "Scenario-only evidence"}
                </p>
                <strong>{scenario.headline}</strong>
                {scenario.financingFacts ? (
                  <>
                    <small>
                      Reported terms:{" "}
                      {financingScenarioTermsLabel(scenario.financingFacts)}.
                    </small>
                    <small>
                      Holding impact not calculated. No holding mark or forecast
                      changes.
                    </small>
                  </>
                ) : (
                  <small>
                    {scenario.priorValue} → {scenario.replacementValue} ·
                    estimated impact{" "}
                    {scenario.forecastImpactMinor >= 0 ? "+" : ""}
                    {formatCompactMoney(scenario.forecastImpactMinor)}
                  </small>
                )}
              </div>
              <Button tone="quiet" onClick={() => setScenario(null)}>
                Dismiss
              </Button>
            </div>
          ) : (
            <p className="catalogue-note">
              Open a report and choose Scenario only to see its context here.
            </p>
          )}
          <p className="catalogue-note">
            This excerpt shows the report context. Editing assumptions and
            saving a scenario are separate actions in Scenarios.
          </p>
        </section>
      )}
      <Collapsible>
        <CollapsibleTrigger layout="inline">
          Capture controls and source <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="catalogue-note">
            Synthetic reports from one company. Watch opens the selected event
            in the full inbox. The administrator statement has its own mapped
            mark. Source links open local sample documents. This capture omits
            monitoring, grouped report reconciliation and the scenario editor.
          </p>
          <p className="catalogue-note">
            Product reference · Keel 33ad9f3 · PortfolioWatch, EvidenceInbox and
            Scenarios in apps/web/src/App.tsx.
          </p>
          <ActionGroup wrap>
            <Button
              tone="quiet"
              disabled={busy.length > 0}
              aria-pressed={failNext}
              onClick={() => setFailNext(!failNext)}
            >
              Fail next review
            </Button>
            <Button
              tone="quiet"
              onClick={() => openReport("unavailable-report")}
            >
              Open unavailable report
            </Button>
            <Button
              tone="quiet"
              disabled={busy.length > 0}
              onClick={() => {
                setProgress(empty);
                setScenario(null);
                setError(null);
                setFailNext(false);
                location.hash = watchHref;
              }}
            >
              Reset synthetic reports
            </Button>
          </ActionGroup>
          <p className="catalogue-note">
            Demo decisions and personal read state stay in this tab. Reloading
            clears the scenario banner. No application requests are made.
          </p>
          <TextLink href={"#journeys/" + evidenceProposalRoute}>
            Explore the Apply / Ignore proposal
          </TextLink>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
