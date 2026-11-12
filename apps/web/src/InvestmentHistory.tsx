import { useEffect, useState } from "react";
import { z } from "zod";
import {
  InvestmentReconciliationSchema,
  InvestmentTaxLotsPageSchema,
  InvestmentTransactionsPageSchema,
  type InvestmentReconciliation,
  type InvestmentTaxLot,
  type InvestmentTransaction,
} from "@keel/domain/investment-history";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  FormMessage,
  DatePicker,
  Field,
  DisclosureIndicator,
  RecordItem,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Text,
  TextLink,
} from "@keel/ui";
import { requestKeel } from "./api-request";
import { formatDate } from "./format";

const HistoryPageSchema = z.union([
  InvestmentTaxLotsPageSchema,
  InvestmentTransactionsPageSchema,
]);
const amount = (value: number | null, scale = 2, prefix = "$") => {
  if (value === null) return "Not supplied";
  const n = BigInt(value),
    abs = n < 0n ? -n : n,
    denominator = 10n ** BigInt(scale);
  const whole = (abs / denominator)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
  const fraction = (abs % denominator)
    .toString()
    .padStart(scale, "0")
    .replace(/0+$/u, "");
  return (
    (n < 0n ? "−" : "") + prefix + whole + (fraction ? "." + fraction : "")
  );
};
const shares = (n: number | null) => amount(n, 6, "");
const timestamp = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value))
    : "Not captured";
async function read<T extends z.ZodType>(
  path: string,
  query: URLSearchParams,
  schema: T,
  signal: AbortSignal,
): Promise<z.output<T>> {
  const response = await requestKeel(
    "/api/v1/" + path + "?" + query.toString(),
    {
      signal,
    },
  );
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "History changed. Reload history to compare a consistent revision."
        : "Investment history could not be loaded. Try again.",
    );
  return schema.parse(await response.json());
}
function useHistoryRead<S extends z.ZodType>(
  path: string | null,
  query: string,
  schema: S,
  revision: string,
) {
  const key = JSON.stringify([path, query, revision]);
  const [state, setState] = useState<{
    key: string;
    data: z.output<S> | null;
    error: string | null;
  }>({ key: "", data: null, error: null });
  useEffect(() => {
    if (path === null) return;
    const controller = new AbortController();
    read(path, new URLSearchParams(query), schema, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ key, data, error: null });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({
            key,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "History is unavailable.",
          });
      });
    return () => controller.abort();
  }, [key, path, query, schema]);
  return {
    data: state.key === key ? state.data : null,
    error: state.key === key ? state.error : null,
    loading: path !== null && state.key !== key,
  };
}
function Transaction({ record }: { record: InvestmentTransaction }) {
  return (
    <Collapsible>
      <RecordItem
        title={`${record.type === "cash" ? record.subtype : record.type.charAt(0).toUpperCase() + record.type.slice(1)}${record.ticker ? " · " + record.ticker : ""}`}
        detail={`${formatDate(record.postedOn)} · Posting date${record.quantityMicros ? " · " + (record.quantityPrecision === "rounded_to_millionths" ? "About " : "") + shares(record.quantityMicros) + " shares" : ""}`}
        metadata={
          record.presence === "not_in_latest_complete_report"
            ? "Missing from latest broker report · Status unconfirmed"
            : record.presence === "not_checked"
              ? "Outside confirmed activity coverage"
              : record.revision > 1
                ? `Broker correction · Version ${record.revision}`
                : undefined
        }
        action={
          <>
            <Text>
              {record.cashDeltaMinor !== null && record.cashDeltaMinor > 0
                ? "+"
                : ""}
              {amount(record.cashDeltaMinor)}
            </Text>
            <CollapsibleTrigger layout="inline">
              Details <DisclosureIndicator />
            </CollapsibleTrigger>
          </>
        }
      >
        <CollapsibleContent>
          <div className="investment-history__source">
            {record.unitPriceMicros !== null && record.quantityMicros !== 0 && (
              <Text>
                Reported price {amount(record.unitPriceMicros, 6)} per unit
              </Text>
            )}
            {record.feesMinor !== null && (
              <Text>
                Fees {amount(record.feesMinor)} · Included in the reported cash
                movement
              </Text>
            )}
            {record.initiatedAt && (
              <Text>
                Order initiated {formatDate(record.initiatedAt.slice(0, 10))} ·
                Precise time not established
              </Text>
            )}
            <Text variant="supporting">
              Received {timestamp(record.receivedAt)} · Exact execution time is
              not provided.
            </Text>
            {record.quantityPrecision === "rounded_to_millionths" && (
              <Text variant="supporting">
                Provider quantity {record.sourceQuantityDecimal} · Display
                rounded to millionths of a share
              </Text>
            )}
            <Text variant="supporting">
              Provider transaction {record.providerTransactionId}
            </Text>
            <Text variant="supporting">
              Source evidence {record.evidenceId}
            </Text>
            {record.presence === "not_in_latest_complete_report" && (
              <Text>
                This previously reported event was absent from the latest
                complete report. A cancellation or reversal is not confirmed.
              </Text>
            )}
            {record.previous && (
              <Text>
                Previous version: {shares(record.previous.quantityMicros)}{" "}
                shares · {amount(record.previous.cashDeltaMinor)} cash movement
                · Posted {formatDate(record.previous.postedOn)}. The current
                version is counted once.
              </Text>
            )}
          </div>
        </CollapsibleContent>
      </RecordItem>
    </Collapsible>
  );
}
function Lot({ record }: { record: InvestmentTaxLot }) {
  return (
    <Collapsible>
      <RecordItem
        title={
          record.acquiredAt
            ? `Acquired ${formatDate(record.acquiredAt.slice(0, 10))}`
            : "Acquisition date not supplied"
        }
        detail={`${record.quantityPrecision === "rounded_to_millionths" ? "About " : ""}${shares(record.quantityMicros)} shares remaining${record.positionType === "SHORT" ? " · Short position" : ""}`}
        metadata="Broker reported"
        action={
          <CollapsibleTrigger layout="inline">
            Source &amp; purchase price <DisclosureIndicator />
          </CollapsibleTrigger>
        }
      >
        <div className="investment-history__lot-values">
          <Text>
            Reported basis per share {amount(record.basisPerUnitMicros, 6)}
          </Text>
          <Text>Total reported basis {amount(record.costBasisMinor)}</Text>
        </div>
        <CollapsibleContent>
          <div className="investment-history__source">
            <Text>
              Purchase price {amount(record.purchasePriceMicros, 6)} per share
            </Text>
            <Text variant="supporting">
              Reported basis can include fees and adjustments. Purchase price is
              a separate fact.
            </Text>
            {record.quantityPrecision === "rounded_to_millionths" && (
              <Text variant="supporting">
                Provider quantity {record.sourceQuantityDecimal} · Display
                rounded to millionths of a share
              </Text>
            )}
            {record.providerLotId && (
              <Text variant="supporting">
                Broker lot {record.providerLotId}
              </Text>
            )}
            <Text variant="supporting">
              Source evidence {record.evidenceId}
            </Text>
          </div>
        </CollapsibleContent>
      </RecordItem>
    </Collapsible>
  );
}
const headings: Record<InvestmentReconciliation["status"], string> = {
  not_synced: "Investment history has not been captured.",
  insufficient_coverage:
    "Whether trades are reflected in the reported share count is unknown.",
  insufficient_timing:
    "Whether trades are reflected in the reported share count is unknown.",
  pending_snapshot: "Activity is newer than these holdings.",
  unexplained_difference: "Activity does not explain the entire share change.",
  reconciled: "Recorded activity explains the reported share change.",
};

export function InvestmentHistory({
  positionId,
  snapshotId,
}: {
  positionId: string;
  snapshotId?: string | undefined;
}) {
  const [refresh, setRefresh] = useState(0);
  const refreshKey = String(refresh) + ":" + (snapshotId ?? "");
  const reconciliationRead = useHistoryRead(
    "investment-reconciliation",
    new URLSearchParams({ positionId }).toString(),
    InvestmentReconciliationSchema,
    refreshKey,
  );
  const reconciliation = reconciliationRead.data,
    initialError = reconciliationRead.error;
  const [tab, setTab] = useState("activity");
  const [account, setAccount] = useState(false);
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("highest_basis");
  const [draft, setDraft] = useState({ from: "", through: "" });
  const [dates, setDates] = useState(draft);
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const reset = () => {
    setPageIndex(0);
    setCursors([undefined]);
  };
  const nextQuery = new URLSearchParams(
    account && reconciliation
      ? { accountId: reconciliation.context.accountId }
      : { positionId },
  );
  if (reconciliation?.context.readContextId)
    nextQuery.set("readContextId", reconciliation.context.readContextId);
  if (cursors[pageIndex]) nextQuery.set("after", cursors[pageIndex]);
  if (tab === "lots") nextQuery.set("sort", sort);
  else {
    if (type !== "all") nextQuery.set("type", type);
    if (dates.from) nextQuery.set("from", dates.from);
    if (dates.through) nextQuery.set("through", dates.through);
  }
  const queryString = nextQuery.toString();
  const pageRead = useHistoryRead(
    reconciliation?.context.readContextId &&
      reconciliation.status !== "not_synced"
      ? tab === "lots"
        ? "tax-lots"
        : "investment-transactions"
      : null,
    queryString,
    HistoryPageSchema,
    refreshKey,
  );
  const mismatched =
    pageRead.data &&
    pageRead.data.context.readContextId !==
      reconciliation?.context.readContextId;
  const data = mismatched ? null : pageRead.data;
  const error = mismatched
    ? "History changed. Reload history to compare a consistent revision."
    : pageRead.error;
  const loading = pageRead.loading;
  const reload = () => {
    reset();
    setRefresh((v) => v + 1);
  };
  const lotPage = data && "coverage" in data ? data : null;
  const activityPage = data && !("coverage" in data) ? data : null;
  const staleHolding = Boolean(
    snapshotId &&
    reconciliation?.context.holdingsSnapshotId &&
    snapshotId !== reconciliation.context.holdingsSnapshotId,
  );
  const datesInvalid = Boolean(
    draft.from && draft.through && draft.from > draft.through,
  );
  return (
    <section
      className="investment-history holding-detail-section"
      aria-label="Investment activity and tax lots"
    >
      {initialError ? (
        <>
          <FormMessage tone="error">{initialError}</FormMessage>
          <Button tone="secondary" onClick={reload}>
            Reload history
          </Button>
        </>
      ) : !reconciliation ? (
        <Text role="status">Loading investment history…</Text>
      ) : (
        <>
          <div className="investment-history__answer">
            <SectionHeader
              headingAs="h3"
              title={
                staleHolding
                  ? "Holdings changed since this page loaded."
                  : headings[reconciliation.status]
              }
            />
            <Text>
              {staleHolding
                ? "Reload the holding before comparing activity with its displayed value."
                : reconciliation.reason}
            </Text>
            {reconciliation.context.coverage.lastSuccessfulSyncAt && (
              <Text variant="supporting">
                History last synced{" "}
                {timestamp(
                  reconciliation.context.coverage.lastSuccessfulSyncAt,
                )}
              </Text>
            )}
            {reconciliation.context.lastAttemptStatus === "failed" && (
              <FormMessage tone="error">
                The latest history check failed. Showing the last successful
                history.
              </FormMessage>
            )}
            {reconciliation.status !== "not_synced" && (
              <Collapsible>
                <CollapsibleTrigger layout="inline">
                  View reconciliation <DisclosureIndicator />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="investment-history__source">
                    {reconciliation.openingQuantityMicros !== null && (
                      <Text>
                        Opening shares{" "}
                        {shares(reconciliation.openingQuantityMicros)} ·
                        Activity {shares(reconciliation.activityQuantityMicros)}{" "}
                        · Expected{" "}
                        {shares(reconciliation.expectedQuantityMicros)} ·
                        Reported {shares(reconciliation.reportedQuantityMicros)}
                      </Text>
                    )}
                    {reconciliation.unexplainedQuantityMicros !== null && (
                      <Text>
                        Unexplained difference{" "}
                        {shares(reconciliation.unexplainedQuantityMicros)}{" "}
                        shares
                      </Text>
                    )}
                    {!reconciliation.context.quantityEffectiveOn && (
                      <Text>
                        The quantity effective date is not supplied. A price
                        date, provider refresh or capture time cannot establish
                        trade inclusion.
                      </Text>
                    )}
                    <Text variant="supporting">
                      Cash reconciliation is not established. Cost basis remains
                      broker reported.
                    </Text>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
          <ActionGroup wrap>
            <TextLink
              onClick={() => {
                setAccount((v) => !v);
                setTab("activity");
                setType("all");
                reset();
              }}
            >
              {account ? "Back to holding activity" : "View account activity"}
            </TextLink>
          </ActionGroup>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(String(value));
              reset();
            }}
          >
            <TabsList variant="line" aria-label="Investment history views">
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="lots" disabled={account}>
                Tax lots
              </TabsTrigger>
            </TabsList>
            <div className="investment-history__heading">
              <SectionHeader
                headingAs="h3"
                title={
                  account
                    ? "Entire account activity"
                    : tab === "lots"
                      ? "Remaining tax lots"
                      : "Holding activity"
                }
              />
              {tab === "lots" ? (
                <Select
                  value={sort}
                  onValueChange={(value) => {
                    setSort(
                      typeof value === "string" ? value : "highest_basis",
                    );
                    reset();
                  }}
                >
                  <SelectTrigger aria-label="Sort tax lots">
                    <SelectValue>
                      {sort === "oldest"
                        ? "Oldest acquisition"
                        : "Highest basis per share"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="highest_basis">
                      Highest basis per share
                    </SelectItem>
                    <SelectItem value="oldest">Oldest acquisition</SelectItem>
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={type}
                  onValueChange={(value) => {
                    setType(typeof value === "string" ? value : "all");
                    reset();
                  }}
                >
                  <SelectTrigger aria-label="Activity type">
                    <SelectValue>
                      {
                        (
                          {
                            all: "All activity",
                            buy: "Purchases",
                            sell: "Sales",
                            cash: "Cash activity",
                            fee: "Fees",
                            transfer: "Transfers",
                            cancel: "Cancellations",
                          } as Record<string, string>
                        )[type]
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      ["all", "All activity"],
                      ["buy", "Purchases"],
                      ["sell", "Sales"],
                      ["cash", "Cash activity"],
                      ["fee", "Fees"],
                      ["transfer", "Transfers"],
                      ["cancel", "Cancellations"],
                    ].map(([value, label]) => (
                      <SelectItem key={value} value={value!}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {tab === "activity" && (
              <form
                className="investment-history__filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!datesInvalid) {
                    setDates(draft);
                    reset();
                  }
                }}
              >
                <Field label="From">
                  {(control) => (
                    <DatePicker
                      {...control}
                      aria-label="From"
                      value={draft.from}
                      onValueChange={(from) => setDraft({ ...draft, from })}
                    />
                  )}
                </Field>
                <Field label="Through">
                  {(control) => (
                    <DatePicker
                      {...control}
                      aria-label="Through"
                      value={draft.through}
                      onValueChange={(through) =>
                        setDraft({ ...draft, through })
                      }
                    />
                  )}
                </Field>
                <Button
                  tone="secondary"
                  type="submit"
                  disabled={datesInvalid || loading}
                >
                  Apply dates
                </Button>
                {datesInvalid && (
                  <FormMessage tone="error">
                    The start date must not follow the end date.
                  </FormMessage>
                )}
              </form>
            )}
            {error ? (
              <>
                <FormMessage tone="error">{error}</FormMessage>
                <Button tone="secondary" onClick={reload}>
                  Reload history
                </Button>
              </>
            ) : loading ? (
              <Text role="status">
                Loading {tab === "lots" ? "tax lots" : "activity"}…
              </Text>
            ) : (
              <>
                <TabsContent value="activity">
                  {activityPage?.context.coverage.requestedFrom && (
                    <Text variant="supporting">
                      Posting dates ·{" "}
                      {formatDate(activityPage.context.coverage.requestedFrom)}–
                      {formatDate(
                        activityPage.context.coverage.requestedThrough!,
                      )}{" "}
                      ·{" "}
                      {activityPage.context.coverage.status === "complete"
                        ? "Provider-reported interval"
                        : "Partial coverage"}
                    </Text>
                  )}
                  {activityPage &&
                    ((dates.from &&
                      dates.from <
                        (activityPage.context.coverage.requestedFrom ??
                          dates.from)) ||
                      (dates.through &&
                        dates.through >
                          (activityPage.context.coverage.requestedThrough ??
                            dates.through))) && (
                      <FormMessage>
                        These filters extend beyond the last captured interval.
                        Results may be incomplete.
                      </FormMessage>
                    )}
                  {activityPage?.items.length ? (
                    activityPage.items.map((record) => (
                      <Transaction key={record.id} record={record} />
                    ))
                  ) : (
                    <EmptyState
                      compact
                      icon={null}
                      title={
                        reconciliation.status === "not_synced"
                          ? "No activity captured yet."
                          : activityPage?.context.coverage.status === "complete"
                            ? "No transactions reported for this filter."
                            : "Activity coverage is incomplete."
                      }
                    />
                  )}
                </TabsContent>
                <TabsContent value="lots">
                  {lotPage &&
                    lotPage.coverage.status !== "not_synced" &&
                    lotPage.context.capturedAt && (
                      <Text variant="supporting">
                        Lot coverage checked{" "}
                        {timestamp(lotPage.context.capturedAt)}
                      </Text>
                    )}
                  {lotPage?.coverage.status === "unavailable" ? (
                    <EmptyState
                      compact
                      icon={null}
                      title={
                        lotPage.coverage.reason === "invalid_evidence"
                          ? "The tax-lot report could not be read safely."
                          : "The broker did not provide tax lots."
                      }
                    >
                      Aggregate cost basis cannot establish which purchased
                      shares remain.
                    </EmptyState>
                  ) : lotPage?.items.length ? (
                    <>
                      <Text>
                        {shares(lotPage.coverage.coveredQuantityMicros)} of{" "}
                        {shares(lotPage.coverage.reportedQuantityMicros)}{" "}
                        reported shares covered by lots.
                      </Text>
                      {(lotPage.coverage.status !== "complete" ||
                        !lotPage.coverage.allBasisKnown) && (
                        <FormMessage>
                          Lot or basis coverage is partial. Higher-cost lots may
                          be missing.
                        </FormMessage>
                      )}
                      {lotPage.items.map((record) => (
                        <Lot key={record.id} record={record} />
                      ))}
                      <Text variant="supporting">
                        Selling shares and selecting lots happen at the broker.
                      </Text>
                    </>
                  ) : (
                    <EmptyState
                      compact
                      icon={null}
                      title={
                        lotPage?.coverage.status === "partial"
                          ? "Tax-lot coverage is incomplete."
                          : "No tax-lot report has been captured for this holding."
                      }
                    />
                  )}
                </TabsContent>
                {data && (
                  <ActionGroup wrap>
                    {pageIndex > 0 && (
                      <Button
                        tone="secondary"
                        onClick={() => setPageIndex((i) => i - 1)}
                      >
                        Previous page
                      </Button>
                    )}
                    {data.nextAfter && (
                      <Button
                        tone="secondary"
                        onClick={() => {
                          setCursors((old) => [
                            ...old.slice(0, pageIndex + 1),
                            data.nextAfter!,
                          ]);
                          setPageIndex((i) => i + 1);
                        }}
                      >
                        Next page
                      </Button>
                    )}
                  </ActionGroup>
                )}
              </>
            )}
          </Tabs>
        </>
      )}
    </section>
  );
}
