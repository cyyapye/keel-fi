import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  PortfolioWatchActivity,
  WatchRun,
  WatchSourceActivity,
} from "@keel/domain/portfolio-watch-activity";
import {
  ActionGroup,
  Button,
  ButtonLink,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  EmptyState,
  Notice,
  PageHeader,
  Screen,
  SectionHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@keel/ui";
import { loadPortfolioWatchActivity, loadPortfolioWatchProgress } from "./api";
import {
  formatWatchTime,
  nextWatchAttempt,
  watchSourceProblem,
} from "./portfolio-watch-format";
import { useBoundedPolling } from "./use-bounded-polling";

const activeRun = (run: WatchRun) =>
  run.status === "queued" || run.status === "running";
const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;
function runOutcome(run: WatchRun): string {
  if (activeRun(run))
    return `${run.completedCount} of ${run.totalCount} sources checked`;
  const unavailable =
    run.failedCount + run.skippedCount + (run.totalCount - run.completedCount);
  const signals =
    run.signalCount > 0
      ? ` · ${plural(run.signalCount, "new signal")}`
      : run.succeededCount > 0
        ? " · No new signals from those sources"
        : "";
  return `${run.succeededCount} of ${run.totalCount} sources read${signals}${unavailable > 0 ? ` · ${unavailable} unavailable` : ""}`;
}
function runTitle(run: WatchRun): string {
  if (run.status === "queued") return "Waiting to check sources";
  if (run.status === "running") return "Checking sources…";
  if (run.status === "timed_out") return "This check did not finish";
  if (run.status === "failed") return "Source check failed";
  return `Last check completed ${formatWatchTime(run.completedAt)}`;
}

function SourceDetails({
  source,
  asOf,
}: {
  source: WatchSourceActivity;
  asOf: string;
}) {
  const unavailable =
    source.outcome === "failed" ||
    source.outcome === "skipped" ||
    ["degraded", "quarantined", "revoked"].includes(source.status);
  return (
    <article className="watch-source-detail">
      <ButtonLink
        href={source.url}
        target="_blank"
        rel="noreferrer"
        tone="plain"
      >
        {source.kind === "official_rss"
          ? "Official RSS feed"
          : source.kind === "official_atom"
            ? "Official Atom feed"
            : "Company website"}{" "}
        ↗
      </ButtonLink>
      <p className="watch-source-url">{source.url}</p>
      <p>
        {source.pendingState === "timed_out"
          ? watchSourceProblem("check_timed_out")
          : source.pendingState === "running"
            ? "Reading this source…"
            : source.pendingState === "queued"
              ? "Waiting to check this source"
              : unavailable
                ? watchSourceProblem(source.errorCode)
                : source.lastCompletedAt === null
                  ? "Waiting for a completed check"
                  : source.signalCount > 0
                    ? plural(source.signalCount, "new signal")
                    : "No new signals"}
      </p>
      <small>
        Last successful check: {formatWatchTime(source.lastSuccessAt)}
      </small>
      {source.lastAttemptAt !== null && (
        <small>Last attempt: {formatWatchTime(source.lastAttemptAt)}</small>
      )}
      {source.nextCheckAt !== null && (
        <small>
          Next scheduled attempt:{" "}
          {formatWatchTime(nextWatchAttempt(source.nextCheckAt, asOf))}
        </small>
      )}
    </article>
  );
}

export function PortfolioWatchMonitor({
  onScan,
  onRefresh,
  signalCount,
  renderSignals,
  sourceLabel,
}: {
  onScan: () => Promise<{ queuedCount: number }>;
  onRefresh: () => Promise<void>;
  signalCount: number;
  renderSignals: (start: number, end: number) => ReactNode;
  sourceLabel: string;
}) {
  const [activity, setActivity] = useState<PortfolioWatchActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [signalPage, setSignalPage] = useState(0);
  const [tab, setTab] = useState("coverage");
  const mounted = useRef(true);
  const pageCursor = useRef(cursor);
  const readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    pageCursor.current = cursor;
    const sequence = ++readSequence.current;
    void loadPortfolioWatchActivity(cursor)
      .then((value) => {
        if (current && sequence === readSequence.current) {
          setActivity(value);
          setError(null);
        }
      })
      .catch(() => {
        if (current) setError("Couldn’t load source activity. Try again.");
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [cursor]);
  const running = activity?.runs.find(activeRun);
  const reload = async () => {
    const sequence = ++readSequence.current;
    const value = await loadPortfolioWatchActivity(cursor);
    if (
      mounted.current &&
      pageCursor.current === cursor &&
      sequence === readSequence.current
    ) {
      setActivity(value);
      setError(null);
    }
    return value;
  };
  const refreshSignals = async () => {
    try {
      await onRefresh();
    } catch {
      if (mounted.current)
        setError(
          "Checks finished, but signals couldn’t be refreshed. Refresh activity to try again.",
        );
    }
  };
  useBoundedPolling({
    active: running !== undefined,
    identity: running?.id ?? "none",
    intervalMs: 10_000,
    expiresAt: running?.deadlineAt,
    check: async () => {
      if (running === undefined) return false;
      const progress = await loadPortfolioWatchProgress(running.id);
      const sources = new Map(
        progress.sources.map((source) => [source.id, source]),
      );
      if (mounted.current)
        setActivity((value) =>
          value === null
            ? null
            : {
                ...value,
                asOf: progress.asOf,
                runs: progress.runs,
                companies: value.companies.map((company) => ({
                  ...company,
                  sources: company.sources.map(
                    (source) => sources.get(source.id) ?? source,
                  ),
                })),
              },
        );
      const stillRunning = progress.runs.some(activeRun);
      if (!stillRunning && mounted.current) {
        try {
          await reload();
        } catch {
          setError(
            "Checks finished, but coverage couldn’t be refreshed. Refresh activity to try again.",
          );
        }
        await refreshSignals();
      }
      return stillRunning;
    },
    onError: () =>
      setError(
        "Couldn’t refresh progress. Keel will retry while this check is active.",
      ),
    onTimeout: () => {
      setActivity((value) =>
        value === null
          ? null
          : {
              ...value,
              companies: value.companies.map((company) => ({
                ...company,
                sources: company.sources.map((source) =>
                  source.pendingState === "queued" ||
                  source.pendingState === "running"
                    ? { ...source, pendingState: "timed_out" }
                    : source,
                ),
              })),
              runs: value.runs.map((run) =>
                activeRun(run) ? { ...run, status: "timed_out" } : run,
              ),
            },
      );
      setError(
        "This check did not finish in time. Refresh activity or check again.",
      );
    },
  });
  const scan = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await onScan();
      const value = await reload();
      if (result.queuedCount > 0 && !value.runs.some(activeRun))
        await refreshSignals();
      if (result.queuedCount === 0 && !value.runs.some(activeRun))
        setMessage(
          "No eligible sources were available to check. See coverage below.",
        );
    } catch {
      setError(
        "Couldn’t start the check. Refresh activity before trying again.",
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const latest = activity?.runs[0];
  return (
    <Screen className="watch-screen">
      <PageHeader
        className="watch-intro"
        title="Portfolio Watch"
        description="Public news and updates for your private holdings."
        actions={
          <Button
            tone="primary"
            disabled={
              busy || running !== undefined || loading || activity === null
            }
            onClick={() => {
              void scan();
            }}
          >
            {busy || running !== undefined ? "Checking…" : "Check now"}
          </Button>
        }
      />
      <section
        className="watch-activity-summary"
        aria-live="polite"
        data-testid="portfolio-watch-control"
      >
        <h2>
          {latest === undefined
            ? loading
              ? "Loading source activity…"
              : error !== null
                ? "Source activity unavailable"
                : "No completed checks recorded yet"
            : runTitle(running ?? latest)}
        </h2>
        {latest !== undefined && <p>{runOutcome(running ?? latest)}</p>}
        {running !== undefined && (
          <progress
            aria-label="Sources checked"
            value={running.completedCount}
            max={running.totalCount}
          />
        )}
        <small>
          {sourceLabel} · Healthy sources checked weekly
          {activity?.summary.nextCheckAt != null
            ? ` · Next scheduled attempt ${formatWatchTime(nextWatchAttempt(activity.summary.nextCheckAt, activity.asOf))}`
            : ""}
        </small>
        {activity !== null && activity.summary.sourceCount > 40 && (
          <small>
            Each check covers up to 40 sources. Additional sources remain
            scheduled.
          </small>
        )}
      </section>
      {error !== null && (
        <Notice tone="error">
          {error}{" "}
          <Button
            tone="plain"
            onClick={() => {
              void reload()
                .then(refreshSignals)
                .catch(() =>
                  setError("Couldn’t load source activity. Try again."),
                );
            }}
          >
            Refresh activity
          </Button>
        </Notice>
      )}
      {message !== null && <p role="status">{message}</p>}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList
          className="section-navigation__tabs watch-tabs"
          variant="line"
          aria-label="Watch information"
        >
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
          <TabsTrigger value="signals">Signals ({signalCount})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="coverage">
          <SectionHeader
            title={
              activity === null
                ? "Source coverage"
                : `${plural(activity.summary.companyCount, "company").replace("companys", "companies")} · ${plural(activity.summary.sourceCount, "source")}`
            }
          />
          {activity?.companies.length === 0 && (
            <EmptyState title="No companies to monitor">
              Companies appear here once a current private holding has a
              confirmed company identity.
            </EmptyState>
          )}
          <div className="watch-coverage-list">
            {activity?.companies.map((company) => {
              const sources = company.sources;
              const failed = sources.filter(
                (source) =>
                  source.outcome === "failed" ||
                  source.outcome === "skipped" ||
                  source.pendingState === "timed_out" ||
                  ["degraded", "quarantined", "revoked"].includes(
                    source.status,
                  ),
              ).length;
              const checked = sources.filter(
                (source) => source.outcome === "succeeded",
              ).length;
              const waiting = sources.filter(
                (source) => source.lastCompletedAt === null,
              ).length;
              const pending = sources.filter(
                (source) =>
                  source.pendingState === "queued" ||
                  source.pendingState === "running",
              ).length;
              const lastCompletedAt =
                sources
                  .map((source) => source.lastCompletedAt)
                  .filter((value) => value !== null)
                  .sort()
                  .at(-1) ?? null;
              const signals = sources.reduce(
                (count, source) => count + source.signalCount,
                0,
              );
              return (
                <Collapsible
                  key={company.id}
                  open={expanded === company.id}
                  onOpenChange={(open) => setExpanded(open ? company.id : null)}
                >
                  <CollapsibleTrigger
                    className="watch-company-trigger"
                    data-testid={`watch-target-${company.id}`}
                  >
                    <span>
                      <strong>{company.companyName}</strong>
                      <small>
                        {sources.length === 0
                          ? "No verified public source yet"
                          : pending > 0
                            ? `${pending} of ${sources.length} source checks pending`
                            : failed > 0
                              ? `${failed} of ${sources.length} sources unavailable`
                              : checked === 0
                                ? "Waiting for first completed check"
                                : `${plural(checked, "source")} checked${waiting > 0 ? ` · ${waiting} not checked yet` : ` · ${signals === 0 ? "No new signals" : plural(signals, "new signal")}`}`}
                      </small>
                      {lastCompletedAt !== null && (
                        <small>
                          Last check {formatWatchTime(lastCompletedAt)}
                        </small>
                      )}
                    </span>
                    <DisclosureIndicator />
                  </CollapsibleTrigger>
                  {expanded === company.id && (
                    <CollapsibleContent>
                      {sources.length === 0 ? (
                        <p className="watch-coverage-missing">
                          A reviewed official company website is needed before
                          monitoring can begin.
                        </p>
                      ) : (
                        sources.map((source) => (
                          <SourceDetails
                            key={source.id}
                            source={source}
                            asOf={activity.asOf}
                          />
                        ))
                      )}
                    </CollapsibleContent>
                  )}
                </Collapsible>
              );
            })}
          </div>
          <ActionGroup className="watch-page-actions" wrap>
            {cursor !== null && (
              <Button
                onClick={() => {
                  setExpanded(null);
                  setLoading(true);
                  setCursor(null);
                }}
              >
                First companies
              </Button>
            )}
            {activity?.nextCursor != null && (
              <Button
                disabled={loading}
                onClick={() => {
                  setExpanded(null);
                  setLoading(true);
                  setCursor(activity.nextCursor);
                }}
              >
                Next companies
              </Button>
            )}
          </ActionGroup>
        </TabsContent>
        <TabsContent value="signals">
          <SectionHeader title="Recent signals" />
          {signalCount === 0 ? (
            <EmptyState title="No signals found yet">
              Source coverage and activity show which checks have completed.
            </EmptyState>
          ) : (
            renderSignals(signalPage * 20, signalPage * 20 + 20)
          )}
          <ActionGroup className="watch-page-actions" wrap>
            {signalPage > 0 && (
              <Button onClick={() => setSignalPage((page) => page - 1)}>
                Previous signals
              </Button>
            )}
            {(signalPage + 1) * 20 < signalCount && (
              <Button onClick={() => setSignalPage((page) => page + 1)}>
                Next signals
              </Button>
            )}
          </ActionGroup>
        </TabsContent>
        <TabsContent value="activity">
          <SectionHeader title="Recent checks" />
          {activity?.runs.length === 0 && (
            <EmptyState title="No check history yet">
              History begins with the next scheduled or manual check.
            </EmptyState>
          )}
          <div className="watch-run-list">
            {activity?.runs.map((run) => (
              <article key={run.id}>
                <h3>
                  {run.trigger === "manual" ? "Manual" : "Scheduled"} check ·{" "}
                  {run.status === "timed_out"
                    ? "Did not finish"
                    : activeRun(run)
                      ? run.status === "queued"
                        ? "Waiting"
                        : "Checking"
                      : run.status === "succeeded"
                        ? "Completed"
                        : "Completed with unavailable sources"}
                </h3>
                <p>{runOutcome(run)}</p>
                <small>
                  Requested {formatWatchTime(run.requestedAt)}
                  {run.completedAt === null
                    ? ""
                    : ` · Finished ${formatWatchTime(run.completedAt)}`}
                </small>
              </article>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      <p className="watch-trust-boundary">
        Public signals never change a holding on their own.
      </p>
    </Screen>
  );
}
