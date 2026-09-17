import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicSourceObservation } from "@keel/domain";
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
  SearchField,
  SearchHighlight,
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
  watchUpdatesForReview,
} from "./portfolio-watch-format";
import { useBoundedPolling } from "./use-bounded-polling";
import { WatchWebsiteRecovery } from "./WatchWebsiteRecovery";

const activeRun = (run: WatchRun) =>
  run.status === "queued" || run.status === "running";
const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : noun === "company" ? "companies" : noun === "page or feed" ? "pages or feeds" : `${noun}s`}`;
function runOutcome(run: WatchRun): string {
  if (activeRun(run))
    return `${run.completedCount} of ${run.totalCount} pages and feeds checked`;
  const unavailable =
    run.failedCount + run.skippedCount + (run.totalCount - run.completedCount);
  const signals =
    run.signalCount > 0
      ? ` · ${plural(run.signalCount, "new update")}`
      : run.succeededCount > 0
        ? " · No new updates from those sources"
        : "";
  return `${run.status === "timed_out" ? "This check did not finish · " : ""}${run.succeededCount} of ${run.totalCount} pages and feeds read${signals}${unavailable > 0 ? ` · ${unavailable} unavailable` : ""}`;
}
function runTitle(run: WatchRun): string {
  if (run.status === "queued") return "Waiting to check sources";
  if (run.status === "running") return "Checking sources…";
  if (run.status === "timed_out") return "This check did not finish";
  if (run.status === "failed")
    return `Source check failed · ${formatWatchTime(run.completedAt ?? run.requestedAt)}`;
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
            : "Company website"}
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
                ? watchSourceProblem(source.errorCode, source.httpStatus)
                : source.lastCompletedAt === null
                  ? "Waiting for a completed check"
                  : source.signalCount > 0
                    ? plural(source.signalCount, "new update")
                    : "No new updates"}
      </p>
      <small>
        Last successful read:{" "}
        {source.lastSuccessAt === null
          ? "None recorded"
          : formatWatchTime(source.lastSuccessAt)}
      </small>
      {source.lastAttemptAt !== null && (
        <small>Last attempt: {formatWatchTime(source.lastAttemptAt)}</small>
      )}
      {source.nextCheckAt !== null && (
        <small>
          Eligible for a scheduled check:{" "}
          {formatWatchTime(nextWatchAttempt(source.nextCheckAt, asOf))}
        </small>
      )}
    </article>
  );
}

const sourceUnavailable = (source: WatchSourceActivity) =>
  source.outcome === "failed" ||
  source.outcome === "skipped" ||
  source.pendingState === "timed_out" ||
  ["degraded", "quarantined", "revoked"].includes(source.status);
function publishers(sources: WatchSourceActivity[]) {
  const groups = new Map<string, WatchSourceActivity[]>();
  for (const source of sources) {
    const host = new URL(source.url).hostname.replace(/^www\./, "");
    const group = groups.get(host) ?? [];
    group.push(source);
    groups.set(host, group);
  }
  return [...groups];
}
function PublisherDetails({
  host,
  sources,
  asOf,
}: {
  host: string;
  sources: WatchSourceActivity[];
  asOf: string;
}) {
  const [limit, setLimit] = useState(5);
  const success = sources
    .map((source) => source.lastSuccessAt)
    .filter((value) => value !== null)
    .sort()
    .at(-1);
  const problems = [
    ...new Set(
      sources
        .filter(sourceUnavailable)
        .map((source) =>
          watchSourceProblem(source.errorCode, source.httpStatus),
        ),
    ),
  ];
  return (
    <section className="watch-publisher">
      <strong>{host}</strong>
      <p>
        {plural(
          sources.filter(
            (source) =>
              !sourceUnavailable(source) && source.lastSuccessAt !== null,
          ).length,
          "page or feed",
        )}{" "}
        readable · {sources.length} monitored
      </p>
      <small>
        Last successful read:{" "}
        {success === undefined ? "None recorded" : formatWatchTime(success)}
      </small>
      {problems.map((problem) => (
        <p key={problem}>{problem}</p>
      ))}
      <Collapsible>
        <CollapsibleTrigger className="watch-news-details-trigger">
          Pages and check details ({sources.length}) <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {sources.slice(0, limit).map((source) => (
            <SourceDetails key={source.id} source={source} asOf={asOf} />
          ))}
          {sources.length > limit && (
            <Button tone="quiet" onClick={() => setLimit(limit + 5)}>
              Show more pages
            </Button>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}

export function PortfolioWatchMonitor({
  onScan,
  onRefresh,
  observations,
  decisionIds,
  renderSignals,
  sourceLabel,
}: {
  onScan: () => Promise<{ queuedCount: number }>;
  onRefresh: () => Promise<void>;
  observations: readonly PublicSourceObservation[];
  decisionIds: ReadonlySet<string>;
  renderSignals: (
    observations: readonly PublicSourceObservation[],
  ) => ReactNode;
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
  const [tab, setTab] = useState("updates");
  const [query, setQuery] = useState("");
  const [updateFilter, setUpdateFilter] = useState("unread");
  const [loadedPage, setLoadedPage] = useState<string | null>(null);
  const pageKey = JSON.stringify([cursor, query]);
  const pageReady = !loading && loadedPage === pageKey;
  const updates = watchUpdatesForReview(observations, query, decisionIds);
  const reviewCount = updates.filter((item) => item.needsReview).length;
  const unreadCount = updates.filter((item) => item.unread).length;
  const visibleUpdates = updates.filter(
    (item) =>
      updateFilter === "all" ||
      (updateFilter === "decisions" ? item.needsReview : item.unread),
  );
  const signalCount = visibleUpdates.length;
  const currentSignalPage = Math.min(
    signalPage,
    Math.max(0, Math.ceil(signalCount / 20) - 1),
  );
  const mounted = useRef(true);
  const pageRequest = useRef({ cursor, query });
  const readSequence = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    pageRequest.current = { cursor, query };
    const sequence = ++readSequence.current;
    const timer = window.setTimeout(
      () => {
        void loadPortfolioWatchActivity(cursor, query, controller.signal)
          .then((value) => {
            if (current && sequence === readSequence.current) {
              setActivity(value);
              setLoadedPage(JSON.stringify([cursor, query]));
              setError(null);
            }
          })
          .catch(() => {
            if (current && sequence === readSequence.current)
              setError("Couldn’t load source activity. Try again.");
          })
          .finally(() => {
            if (current && sequence === readSequence.current) setLoading(false);
          });
      },
      query.trim().length > 0 ? 250 : 0,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cursor, query]);
  const running = activity?.runs.find(activeRun);
  const reload = async () => {
    const sequence = ++readSequence.current;
    const { cursor: currentCursor, query: currentQuery } = pageRequest.current;
    const value = await loadPortfolioWatchActivity(currentCursor, currentQuery);
    if (
      mounted.current &&
      pageRequest.current.cursor === currentCursor &&
      pageRequest.current.query === currentQuery &&
      sequence === readSequence.current
    ) {
      setActivity(value);
      setLoadedPage(JSON.stringify([currentCursor, currentQuery]));
      setError(null);
      setLoading(false);
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
          "No eligible sources were available to check. Open Coverage for details.",
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
            tone="quiet"
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
        className={`watch-activity-summary${latest !== undefined && ["failed", "partial", "timed_out"].includes(latest.status) ? " watch-activity-summary--limited" : ""}`}
        aria-live="polite"
        data-testid="portfolio-watch-control"
      >
        <div>
          <strong className="watch-check-title">
            {running !== undefined
              ? runTitle(running)
              : activity === null
                ? loading
                  ? "Loading monitoring status…"
                  : "Monitoring status unavailable"
                : latest === undefined
                  ? "Monitoring has not run yet"
                  : ["failed", "partial", "timed_out"].includes(
                        latest.status,
                      ) ||
                      activity.summary.unavailableCount > 0 ||
                      activity.summary.companiesWithVerifiedSources <
                        activity.summary.companyCount
                    ? "Monitoring limited"
                    : "Monitoring active"}
          </strong>
          {latest !== undefined && <p>{runOutcome(running ?? latest)}</p>}
          {latest !== undefined && (
            <small>
              Last attempt {formatWatchTime(latest.requestedAt)} · Last
              successful read{" "}
              {activity?.summary.lastSuccessAt == null
                ? "none recorded"
                : formatWatchTime(activity.summary.lastSuccessAt)}
            </small>
          )}
          {running !== undefined && (
            <progress
              aria-label="Sources checked"
              value={running.completedCount}
              max={running.totalCount}
            />
          )}
        </div>
        <Button tone="quiet" onClick={() => setTab("coverage")}>
          View coverage & issues
        </Button>
      </section>
      {
        <SearchField
          className="watch-search"
          label="Search companies"
          placeholder="Search companies…"
          value={query}
          onValueChange={(value) => {
            if (value === query) return;
            setQuery(value);
            setCursor(null);
            setExpanded(null);
            setSignalPage(0);
            setLoading(true);
          }}
          resultLabel={
            query.trim().length === 0
              ? undefined
              : loading
                ? "Searching companies…"
                : !pageReady
                  ? "Company search unavailable"
                  : `${activity?.matchingCompanyCount ?? 0} ${(activity?.matchingCompanyCount ?? 0) === 1 ? "company matches" : "companies match"} · ${plural(updates.length, "update")}`
          }
        />
      }
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
          <TabsTrigger value="updates">Updates</TabsTrigger>
          <TabsTrigger value="coverage">Coverage</TabsTrigger>
        </TabsList>
        <TabsContent value="updates">
          <SectionHeader
            className="watch-updates-heading"
            title={
              updateFilter === "decisions"
                ? "Decisions needed"
                : updateFilter === "all"
                  ? "All updates"
                  : "Unread news"
            }
            action={
              <ActionGroup wrap>
                {(
                  [
                    ["unread", `Unread (${unreadCount})`],
                    ["decisions", `Decisions (${reviewCount})`],
                    ["all", "All updates"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    tone="quiet"
                    aria-pressed={updateFilter === value}
                    onClick={() => {
                      setUpdateFilter(value);
                      setSignalPage(0);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </ActionGroup>
            }
          />
          {signalCount === 0 ? (
            <EmptyState
              title={
                updateFilter === "decisions"
                  ? "No decisions needed"
                  : updateFilter === "unread"
                    ? "No unread updates"
                    : "No updates found"
              }
            >
              {query.trim().length > 0
                ? "Try another company or clear your search."
                : updateFilter === "unread" && updates.length > 0
                  ? "Previously read news is available under All updates."
                  : "Open Coverage to see which companies Keel can monitor. A gap in coverage can mean news was missed."}
            </EmptyState>
          ) : (
            renderSignals(
              visibleUpdates
                .slice(currentSignalPage * 20, currentSignalPage * 20 + 20)
                .map((item) => item.observation),
            )
          )}
          <ActionGroup className="watch-page-actions" wrap>
            {currentSignalPage > 0 && (
              <Button onClick={() => setSignalPage(currentSignalPage - 1)}>
                Previous updates
              </Button>
            )}
            {(currentSignalPage + 1) * 20 < signalCount && (
              <Button onClick={() => setSignalPage(currentSignalPage + 1)}>
                Next updates
              </Button>
            )}
          </ActionGroup>
        </TabsContent>
        <TabsContent value="coverage">
          <SectionHeader
            title={
              activity === null
                ? "Source coverage"
                : `${plural(activity.summary.companyCount, "company").replace("companys", "companies")} · ${activity.summary.sourceCount} pages and feeds`
            }
          />
          {activity !== null && (
            <div className="watch-coverage-summary">
              <p>
                {activity.summary.companiesWithVerifiedSources} of{" "}
                {activity.summary.companyCount} companies have a verified source
                · {activity.summary.companiesWithoutWebsite} without a confirmed
                website
              </p>
              <small>
                {sourceLabel}. Pages from the same website are grouped as one
                publisher. A confirmed company website is required before
                monitoring can start.
              </small>
            </div>
          )}
          {loading && <p role="status">Loading companies…</p>}
          {pageReady && activity?.companies.length === 0 && (
            <EmptyState
              title={
                query.trim().length > 0
                  ? "No matching companies"
                  : "No companies to monitor"
              }
            >
              {query.trim().length > 0
                ? "Try another company or clear your search."
                : "Companies appear here once a current private holding has a confirmed company identity."}
            </EmptyState>
          )}
          <div className="watch-coverage-list">
            {pageReady &&
              activity?.companies.map((company) => {
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
                    onOpenChange={(open) =>
                      setExpanded(open ? company.id : null)
                    }
                  >
                    <CollapsibleTrigger
                      className="watch-company-trigger"
                      data-testid={`watch-target-${company.id}`}
                    >
                      <span>
                        <strong>
                          <SearchHighlight query={query}>
                            {company.companyName}
                          </SearchHighlight>
                        </strong>
                        <small>
                          {sources.length === 0
                            ? company.officialHost === null
                              ? "Official website not identified"
                              : "Waiting for website verification"
                            : pending > 0
                              ? `${pending} of ${sources.length} source checks pending`
                              : failed > 0
                                ? `${checked > 0 ? "Partial coverage" : "Coverage unavailable"} · ${failed === 1 ? "1 page or feed needs attention" : `${failed} pages or feeds need attention`}`
                                : checked === 0
                                  ? "Waiting for first completed check"
                                  : `${plural(checked, "page or feed")} read${waiting > 0 ? ` · ${waiting} awaiting first read` : ` · ${signals === 0 ? "No new updates" : plural(signals, "new update")}`}`}
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
                          <div className="watch-coverage-missing">
                            <p>
                              {company.officialHost === null
                                ? "This company has no confirmed website in Keel, so monitoring has not started. A company name alone does not establish its official website."
                                : `Keel has ${company.officialHost} on record. Monitoring starts after the website passes verification.`}
                            </p>
                            {company.officialHost === null && (
                              <WatchWebsiteRecovery
                                targetId={company.id}
                                companyName={company.companyName}
                                canSearch={
                                  activity.websiteSearchAvailable === true
                                }
                                onSaved={reload}
                              />
                            )}
                          </div>
                        ) : (
                          publishers(sources).map(([host, group]) => (
                            <PublisherDetails
                              key={host}
                              host={host}
                              sources={group}
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
                disabled={!pageReady}
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
          <Collapsible className="watch-history">
            <CollapsibleTrigger className="watch-news-details-trigger">
              Check history <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="watch-schedule">
                Healthy sources are checked weekly. Each run checks up to 40
                pages and feeds across companies.
                {activity?.summary.nextCheckAt != null
                  ? ` Next scheduled attempt ${formatWatchTime(nextWatchAttempt(activity.summary.nextCheckAt, activity.asOf))}.`
                  : ""}
              </p>
              {activity?.runs.length === 0 && (
                <EmptyState title="No check history yet">
                  History begins with the next scheduled or manual check.
                </EmptyState>
              )}
              <div className="watch-run-list">
                {activity?.runs.map((run) => (
                  <article key={run.id}>
                    <h3>
                      {run.trigger === "manual" ? "Manual" : "Scheduled"} check
                      ·{" "}
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
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>
      </Tabs>
      <p className="watch-trust-boundary">
        Reading news does not change a holding. Financial changes have their own
        review.
      </p>
    </Screen>
  );
}
