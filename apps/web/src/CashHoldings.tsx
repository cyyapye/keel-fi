import type { AcceptedCashAccount } from "@keel/domain";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import type {
  CashBalanceHistoryPage,
  CashBalanceHistoryEntry,
} from "@keel/domain/cash-balance-history";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  FormMessage,
  RecordGroup,
  RecordRow,
  SearchHighlight,
  SectionHeader,
  Stat,
  TextLink,
} from "@keel/ui";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { loadCashBalanceHistory } from "./api";
import type { HoldingsSearchMatches } from "./collection-search";
import { formatDate } from "./format";
import {
  cashAccountCount,
  cashAmount,
  cashBalanceDetail,
  cashBalances,
  cashTotal,
  foldableCashBalance,
  shouldFoldCashBalances,
  type CashBalanceDisplay,
} from "./cash-holdings-model";
import "./cash-holdings.css";

type HistoryCache = Map<string, CashBalanceHistoryPage>;
type HistoryTarget = Pick<
  CashBalanceDisplay,
  "key" | "revision" | "kind" | "id"
>;
function useHistoryTarget(row: CashBalanceDisplay): HistoryTarget {
  return useMemo(
    () => ({
      key: row.key,
      revision: row.revision,
      kind: row.kind,
      id: row.historyId ?? row.id,
    }),
    [row.key, row.revision, row.kind, row.id, row.historyId],
  );
}
const historyKey = (row: HistoryTarget, limit: 5 | 10, after?: string) =>
  JSON.stringify([row.key, row.revision, limit, after]);
async function readHistory(
  cache: HistoryCache,
  row: HistoryTarget,
  limit: 5 | 10,
  signal: AbortSignal,
  after?: string,
) {
  const key = historyKey(row, limit, after);
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await loadCashBalanceHistory(
    {
      kind: row.kind,
      id: row.id,
      revision: row.revision,
      limit,
      ...(after ? { after } : {}),
    },
    signal,
  );
  if (!signal.aborted) cache.set(key, result);
  return result;
}
function HistoryEntries({
  entries,
  currency,
  full = false,
}: {
  entries: readonly CashBalanceHistoryEntry[];
  currency: string;
  full?: boolean;
}) {
  const facts = (entry: CashBalanceHistoryEntry) => (
    <>
      {entry.initial
        ? ""
        : `${cashAmount(entry.previousValueMinor, currency)} → `}
      {cashAmount(entry.valueMinor, currency)}
    </>
  );
  return full ? (
    <RecordGroup
      aria-label="Recorded balance history"
      className="cash-history__ledger"
    >
      {entries.map((entry) => (
        <RecordRow
          key={entry.id}
          title={formatDate(entry.observedAt)}
          value={facts(entry)}
          metadata={entry.initial ? "First recorded balance" : undefined}
        />
      ))}
    </RecordGroup>
  ) : (
    <ol className="cash-history__recent">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span>{formatDate(entry.observedAt)}</span>
          <span>{facts(entry)}</span>
          {entry.initial && <small>First recorded balance</small>}
        </li>
      ))}
    </ol>
  );
}
function RecentHistory({
  row,
  cache,
  onFullHistory,
}: {
  row: CashBalanceDisplay;
  cache: HistoryCache;
  onFullHistory: () => void;
}) {
  const target = useHistoryTarget(row);
  const [page, setPage] = useState(() => cache.get(historyKey(row, 5)) ?? null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    readHistory(cache, target, 5, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [target, attempt, cache]);
  useEffect(() => {
    if (attempt === 0 || page === null) return;
    const target =
      history.current?.querySelector<HTMLButtonElement>("[data-cash-full]") ??
      history.current
        ?.closest(".cash-holdings__account")
        ?.querySelector<HTMLButtonElement>(".cash-holdings__account-summary");
    target?.focus();
  }, [attempt, page]);
  return (
    <div className="cash-history" ref={history}>
      <h4>{row.valueBasis ? "Reported balance history" : "Balance history"}</h4>
      {error ? (
        <FormMessage tone="error">
          Balance history could not be loaded.{" "}
          <Button
            tone="quiet"
            onClick={() => {
              setError(false);
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </Button>
        </FormMessage>
      ) : page === null ? (
        <p role="status">Loading balance history…</p>
      ) : (
        <>
          {page.total > 5 && (
            <p className="cash-history__meta">
              Latest 5 of {page.total} entries
            </p>
          )}
          <HistoryEntries entries={page.entries} currency={row.currency} />
          {page.total === 0 && <p>No recorded balance history.</p>}
          {page.next && (
            <TextLink data-cash-full={row.key} onClick={onFullHistory}>
              View full history
            </TextLink>
          )}
        </>
      )}
    </div>
  );
}
function FullHistory({
  row,
  cache,
  onBack,
}: {
  row: CashBalanceDisplay;
  cache: HistoryCache;
  onBack: () => void;
}) {
  const target = useHistoryTarget(row);
  const [page, setPage] = useState<CashBalanceHistoryPage | null>(null);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [failedDirection, setFailedDirection] = useState("Older");
  const pending = useRef(true);
  const failedTarget = useRef({
    cursor: undefined as string | undefined,
    index: 0,
  });
  const controller = useRef<AbortController | null>(null);
  const controls = useRef<HTMLElement>(null);
  const focusDirection = useRef<"newer" | "older" | null>(null);
  const load = useCallback(
    async (
      cursor: string | undefined,
      targetIndex: number,
      direction?: "newer" | "older",
    ) => {
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      pending.current = true;
      setBusy(true);
      setError(false);
      if (direction)
        setFailedDirection(direction === "newer" ? "Newer" : "Older");
      failedTarget.current = { cursor, index: targetIndex };
      try {
        const next = await readHistory(
          cache,
          target,
          10,
          request.signal,
          cursor,
        );
        if (request.signal.aborted) return;
        setPage(next);
        setIndex(targetIndex);
        setCursors((previous) => [...previous.slice(0, targetIndex), cursor]);
        focusDirection.current = direction ?? "older";
      } catch {
        if (!request.signal.aborted) setError(true);
      } finally {
        if (!request.signal.aborted) {
          pending.current = false;
          setBusy(false);
        }
      }
    },
    [cache, target],
  );
  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    readHistory(cache, target, 10, request.signal)
      .then((next) => {
        if (!request.signal.aborted) setPage(next);
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!request.signal.aborted) {
          pending.current = false;
          setBusy(false);
        }
      });
    return () => request.abort();
  }, [cache, target]);
  useEffect(() => {
    if (busy || !focusDirection.current) return;
    const buttons = controls.current?.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    );
    const target =
      controls.current?.querySelector<HTMLButtonElement>(
        `[data-direction=${focusDirection.current}]:not(:disabled)`,
      ) ?? buttons?.[0];
    target?.focus();
    focusDirection.current = null;
  }, [busy, page]);
  const navigate = (direction: "newer" | "older") => {
    if (pending.current || !page) return;
    const nextIndex = index + (direction === "older" ? 1 : -1);
    void load(
      direction === "older" ? (page.next ?? undefined) : cursors[nextIndex],
      nextIndex,
      direction,
    );
  };
  return (
    <>
      <Button tone="quiet" data-back-cash onClick={onBack}>
        ← Back to cash
      </Button>
      <SectionHeader
        title={row.valueBasis ? "Reported balance history" : "Balance history"}
        headingProps={{ id: "cash-holdings-title" }}
        description={row.name}
        descriptionProps={{ className: "cash-history__account-name" }}
        descriptionPlacement="title-group"
        trailingStat={
          <Stat
            label={row.valueBasis ? "Accepted cash value" : "Current balance"}
            value={cashAmount(row.valueMinor, row.currency)}
            detail={cashBalanceDetail(row)}
          />
        }
      />
      {page?.firstRecordedAt && (
        <p className="cash-history__meta">
          Recorded since {formatDate(page.firstRecordedAt)}. Checks with no
          balance change are omitted.
        </p>
      )}
      {busy && <p role="status">Loading balance history…</p>}
      {error && (
        <FormMessage tone="error">
          {page
            ? `${failedDirection} entries could not be loaded. Showing ${page.start + (page.entries.length ? 1 : 0)}–${page.start + page.entries.length} of ${page.total} entries.`
            : "Balance history could not be loaded."}{" "}
          <Button
            tone="quiet"
            onClick={() => {
              if (!pending.current)
                void load(
                  failedTarget.current.cursor,
                  failedTarget.current.index,
                );
            }}
          >
            Try again
          </Button>
        </FormMessage>
      )}
      {page && (
        <>
          <HistoryEntries full entries={page.entries} currency={row.currency} />
          <nav
            className="cash-history__paging"
            aria-label="Balance history pages"
            ref={controls}
            aria-busy={busy}
          >
            <Button
              tone="quiet"
              data-direction="newer"
              disabled={busy || index === 0}
              onClick={() => navigate("newer")}
            >
              Newer
            </Button>
            <span role="status">
              {page.start + (page.entries.length ? 1 : 0)}–
              {page.start + page.entries.length} of {page.total} entries
            </span>
            <Button
              tone="quiet"
              data-direction="older"
              disabled={busy || page.next === null}
              onClick={() => navigate("older")}
            >
              Older
            </Button>
          </nav>
        </>
      )}
    </>
  );
}

export function CashHoldingsView({
  accounts,
  data,
  error,
  onShowSmallBalancesChange,
  onOpenHolding,
  openableHoldingIds,
  showSmallBalances,
  searchMatches,
  searchQuery,
  visibleCount,
  onLoadMore,
}: {
  accounts: readonly AcceptedCashAccount[];
  data: InvestmentHoldingsView;
  error: string | null;
  onShowSmallBalancesChange: (open: boolean) => void;
  onOpenHolding: (id: string) => void;
  openableHoldingIds: ReadonlySet<string>;
  showSmallBalances: boolean;
  searchMatches: HoldingsSearchMatches | null;
  searchQuery: string;
  visibleCount: number;
  onLoadMore: () => void;
}) {
  const rows = useMemo(() => cashBalances(accounts, data), [accounts, data]);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [fullKey, setFullKey] = useState<string | null>(null);
  const [cache] = useState<HistoryCache>(() => new Map());
  const root = useRef<HTMLElement>(null);
  const returnKey = useRef<string | null>(null);
  const smallBalancesToggle = useRef<HTMLButtonElement>(null);
  const fullRow = rows.find((row) => row.key === fullKey);
  useLayoutEffect(() => {
    const toggle = smallBalancesToggle.current;
    if (toggle && toggle === document.activeElement) {
      toggle.scrollIntoView({ block: "nearest" });
    }
  }, [showSmallBalances]);
  useEffect(() => {
    if (fullKey) {
      root.current
        ?.querySelector<HTMLButtonElement>("[data-back-cash]")
        ?.focus({ preventScroll: true });
      root.current?.scrollIntoView({ block: "start" });
    } else if (returnKey.current) {
      const link = [
        ...(root.current?.querySelectorAll<HTMLButtonElement>(
          "[data-cash-full]",
        ) ?? []),
      ].find((el) => el.dataset.cashFull === returnKey.current);
      link?.focus();
      returnKey.current = null;
    }
  }, [fullKey]);
  const folded = searchMatches === null && shouldFoldCashBalances(rows);
  const small = rows.filter(foldableCashBalance);
  const filtered = rows.filter((row) =>
    searchMatches !== null
      ? (row.kind === "bank"
          ? searchMatches.accountIds
          : searchMatches.positionIds
        ).has(row.id)
      : !folded || showSmallBalances || !foldableCashBalance(row),
  );
  if (searchMatches !== null && !filtered.length) return null;
  const visible = filtered.slice(0, visibleCount);
  const unavailable = rows.filter((row) => row.valueMinor === null).length;
  const currencyLabel = [...new Set(rows.map((row) => row.currency))]
    .sort()
    .join(" · ");
  return (
    <section
      ref={root}
      aria-labelledby="cash-holdings-title"
      className="cash-holdings"
    >
      {fullRow ? (
        <FullHistory
          key={`${fullRow.key}:${fullRow.revision}`}
          row={fullRow}
          cache={cache}
          onBack={() => {
            returnKey.current = fullRow.key;
            setFullKey(null);
          }}
        />
      ) : (
        <>
          <SectionHeader
            title="Cash"
            headingProps={{ id: "cash-holdings-title" }}
            trailingStat={
              <Stat
                className="cash-holdings__total"
                label={
                  rows.some((row) => row.reviewedValue)
                    ? `${unavailable ? "Known cash" : "Cash"} including reviewed values`
                    : unavailable
                      ? "Known cash"
                      : "Total cash"
                }
                value={cashTotal(rows)}
                detail={`${cashAccountCount(rows)} accounts${currencyLabel ? ` · ${currencyLabel}` : ""}${unavailable ? ` · ${unavailable} balance${unavailable === 1 ? "" : "s"} excluded` : ""}`}
              />
            }
          />
          {error && <FormMessage tone="error">{error}</FormMessage>}
          {rows.length === 0 && (
            <p className="cash-history__meta">
              No cash accounts connected. Connect a bank or brokerage in Sources
              to see its cash balances here.
            </p>
          )}
          {(["bank", "brokerage"] as const).map((kind) => {
            const group = rows.filter((row) => row.kind === kind);
            if (!group.length) return null;
            if (
              searchMatches !== null &&
              !visible.some((row) => row.kind === kind)
            )
              return null;
            const count = cashAccountCount(group);
            const retirement = cashAccountCount(
              group.filter((row) => row.retirement),
            );
            return (
              <section
                key={kind}
                className="cash-holdings__group"
                aria-label={kind === "bank" ? "Bank cash" : "Brokerage cash"}
              >
                <div className="cash-holdings__group-heading">
                  <div>
                    <h3>{kind === "bank" ? "Bank cash" : "Brokerage cash"}</h3>
                    <p>
                      {count} {count === 1 ? "account" : "accounts"}
                      {retirement
                        ? ` · ${retirement} retirement ${retirement === 1 ? "account" : "accounts"} included`
                        : ""}
                    </p>
                  </div>
                  <strong>
                    {group.some((row) => row.valueMinor === null)
                      ? "Known cash · "
                      : ""}
                    {cashTotal(group)}
                  </strong>
                </div>
                <div className="cash-holdings__accounts" role="list">
                  {visible
                    .filter((row) => row.kind === kind)
                    .map((row) => (
                      <Collapsible
                        key={row.key}
                        role="listitem"
                        className="cash-holdings__account"
                        open={open.has(row.key)}
                        onOpenChange={(value) =>
                          setOpen((previous) => {
                            const next = new Set(previous);
                            if (value) next.add(row.key);
                            else next.delete(row.key);
                            return next;
                          })
                        }
                      >
                        <CollapsibleTrigger className="cash-holdings__account-summary">
                          <span>
                            <strong>
                              <SearchHighlight query={searchQuery}>
                                {row.name}
                              </SearchHighlight>
                            </strong>
                            <small>{cashBalanceDetail(row)}</small>
                          </span>
                          <strong>
                            {cashAmount(row.valueMinor, row.currency)}
                          </strong>
                          <DisclosureIndicator />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          {open.has(row.key) && (
                            <RecentHistory
                              key={row.revision}
                              row={row}
                              cache={cache}
                              onFullHistory={() => setFullKey(row.key)}
                            />
                          )}
                          {row.kind === "brokerage" &&
                            openableHoldingIds.has(row.id) && (
                              <TextLink onClick={() => onOpenHolding(row.id)}>
                                Holding details
                              </TextLink>
                            )}
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                </div>
                {folded &&
                  !showSmallBalances &&
                  group.every(foldableCashBalance) && (
                    <p className="cash-history__meta">
                      {group.length} balances under $100
                    </p>
                  )}
              </section>
            );
          })}
          {filtered.length > visibleCount && (
            <div className="exposure-pagination">
              <span>
                Showing {visible.length} of {filtered.length} cash balances
              </span>
              <Button onClick={onLoadMore} tone="secondary">
                Load more cash balances
              </Button>
            </div>
          )}
          {folded && (
            <div className="cash-holdings__fold">
              <Button
                ref={smallBalancesToggle}
                tone="quiet"
                aria-expanded={showSmallBalances}
                aria-describedby="cash-holdings-small-balances"
                onClick={() => onShowSmallBalancesChange(!showSmallBalances)}
              >
                {showSmallBalances
                  ? "Hide small balances"
                  : `Show ${small.length} small balances`}
              </Button>
              <p id="cash-holdings-small-balances">
                Under $100 · {cashTotal(small)} · Included in total
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
