import { useEffect, useId, useState, type ReactNode } from "react";
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
  TextLink,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  EmptyState,
  RecordGroup,
  FormMessage,
  DatePicker,
  Field,
  DisclosureIndicator,
  DataItem,
  DataList,
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
  const fraction = (abs % denominator).toString().padStart(scale, "0");
  const decimals = scale === 2 ? fraction : fraction.replace(/0+$/u, "");
  return (
    (n < 0n ? "−" : "") + prefix + whole + (decimals ? "." + decimals : "")
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
function HistoryRecord({
  label,
  children,
  backLabel,
  details,
  source,
}: {
  label: string;
  children: ReactNode;
  backLabel: string;
  details: ReactNode;
  source: ReactNode;
}) {
  const [showSource, setShowSource] = useState(false);
  return (
    <Collapsible
      role="listitem"
      className="investment-history__record"
      aria-label={label}
      onOpenChange={(open) => {
        if (!open) setShowSource(false);
      }}
    >
      <CollapsibleTrigger className="investment-history__record-trigger">
        {children}
        <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          className="investment-history__details"
          data-source={showSource || undefined}
        >
          <TextLink
            className={
              showSource
                ? "holding-source-nav holding-source-nav--back"
                : "holding-source-nav"
            }
            onClick={() => setShowSource((shown) => !shown)}
          >
            {showSource ? (
              <>
                <DisclosureIndicator /> {backLabel}
              </>
            ) : (
              <>
                Source <DisclosureIndicator />
              </>
            )}
          </TextLink>
          <div className="investment-history__view" inert={showSource}>
            <div>
              <div className="investment-history__view-body">{details}</div>
            </div>
          </div>
          <div className="investment-history__view" inert={!showSource}>
            <div>
              <div className="investment-history__view-body">{source}</div>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Transaction({
  record,
  account,
}: {
  record: InvestmentTransaction;
  account: boolean;
}) {
  const quantity =
    record.quantityMicros === null
      ? null
      : record.type === "buy" || record.type === "sell"
        ? record.quantityMicros < 0
          ? -record.quantityMicros
          : record.quantityMicros
        : record.quantityMicros;
  const label =
    record.type === "cash"
      ? record.subtype
      : record.type.charAt(0).toUpperCase() + record.type.slice(1);
  const security = account ? (record.ticker ?? record.securityName) : null;
  const title =
    label +
    (quantity
      ? ` ${record.quantityPrecision === "rounded_to_millionths" ? "about " : ""}${shares(quantity)} shares`
      : "") +
    (security ? ` · ${security}` : "");
  const qualifier =
    record.presence === "not_in_latest_complete_report"
      ? "Unconfirmed in latest report"
      : record.presence === "not_checked"
        ? "Outside confirmed history"
        : record.revision > 1
          ? "Broker correction"
          : null;
  return (
    <HistoryRecord
      label={title}
      backLabel="Trade details"
      details={
        <>
          <DataList className="investment-history__facts">
            {record.feesMinor !== null && record.feesMinor !== 0 && (
              <DataItem
                label="Fees included"
                value={amount(record.feesMinor)}
              />
            )}
            {record.initiatedAt && (
              <DataItem
                label="Order initiated"
                value={formatDate(record.initiatedAt.slice(0, 10))}
              />
            )}
            {record.previous && (
              <DataItem
                label="Previously reported"
                value={`${shares(record.previous.quantityMicros)} shares · ${amount(record.previous.cashDeltaMinor)} · Posted ${formatDate(record.previous.postedOn)}`}
              />
            )}
          </DataList>
          {record.previous && (
            <Text variant="supporting">
              Updated broker report. Counted once.
            </Text>
          )}
          {record.presence === "not_in_latest_complete_report" && (
            <Text variant="supporting">
              The latest report did not confirm this transaction. Cancellation
              is unconfirmed.
            </Text>
          )}
        </>
      }
      source={
        <>
          <DataList className="investment-history__facts">
            <DataItem label="Posted" value={formatDate(record.postedOn)} />
            {record.initiatedAt && (
              <DataItem
                label="Order initiated"
                value={formatDate(record.initiatedAt.slice(0, 10))}
              />
            )}
            <DataItem label="Received" value={timestamp(record.receivedAt)} />
            <DataItem label="Execution time" value="Not provided" />
            <DataItem label="Fees" value={amount(record.feesMinor)} />
            {record.quantityPrecision === "rounded_to_millionths" && (
              <DataItem
                label="Reported shares"
                value={record.sourceQuantityDecimal}
              />
            )}
            <DataItem
              label="Transaction ID"
              value={record.providerTransactionId}
            />
            <DataItem label="Evidence ID" value={record.evidenceId} />
            {record.revision > 1 && (
              <DataItem label="Report version" value={record.revision} />
            )}
          </DataList>
          {record.quantityPrecision === "rounded_to_millionths" && (
            <Text variant="supporting">
              Displayed shares are rounded to millionths.
            </Text>
          )}
        </>
      }
    >
      <span className="investment-history__record-identity">
        <Text as="span" variant="primary">
          {title}
        </Text>
        <Text as="span" variant="supporting">
          {formatDate(record.postedOn)}
          {record.unitPriceMicros !== null && quantity !== 0 && (
            <> · {amount(record.unitPriceMicros, 6)}/share</>
          )}
        </Text>
        {qualifier && (
          <Text as="span" variant="small">
            {qualifier}
          </Text>
        )}
      </span>
      <Text
        as="span"
        variant={record.cashDeltaMinor === null ? "supporting" : "primary"}
        className="investment-history__record-value"
      >
        {record.cashDeltaMinor === null
          ? "Cash unavailable"
          : `${record.cashDeltaMinor > 0 ? "+" : ""}${amount(record.cashDeltaMinor)}`}
      </Text>
    </HistoryRecord>
  );
}

function Lot({ record }: { record: InvestmentTaxLot }) {
  return (
    <HistoryRecord
      label="Remaining tax lot"
      backLabel="Lot details"
      details={
        <DataList className="investment-history__facts">
          <DataItem
            label="Reported basis"
            value={amount(record.costBasisMinor)}
          />
          <DataItem
            label="Purchase price"
            value={
              record.purchasePriceMicros === null
                ? "Not supplied"
                : `${amount(record.purchasePriceMicros, 6)}/share`
            }
          />
        </DataList>
      }
      source={
        <>
          <DataList className="investment-history__facts">
            <DataItem label="Origin" value="Broker reported" />
            {record.providerLotId && (
              <DataItem label="Broker lot" value={record.providerLotId} />
            )}
            <DataItem label="Evidence ID" value={record.evidenceId} />
            {record.quantityPrecision === "rounded_to_millionths" && (
              <DataItem
                label="Reported shares"
                value={record.sourceQuantityDecimal}
              />
            )}
          </DataList>
          <Text variant="supporting">
            Reported basis can include fees and adjustments. Purchase price is a
            separate fact.
          </Text>
          {record.quantityPrecision === "rounded_to_millionths" && (
            <Text variant="supporting">
              Displayed shares are rounded to millionths.
            </Text>
          )}
        </>
      }
    >
      <span className="investment-history__record-identity">
        <Text as="span" variant="primary">
          {record.quantityMicros === null
            ? "Shares unavailable"
            : `${record.quantityPrecision === "rounded_to_millionths" ? "About " : ""}${shares(record.quantityMicros)} shares`}
        </Text>
        <Text as="span" variant="supporting">
          {record.acquiredAt
            ? `Acquired ${formatDate(record.acquiredAt.slice(0, 10))}`
            : "Acquisition date unavailable"}
        </Text>
        {record.positionType === "SHORT" && (
          <Text as="span" variant="small">
            Short position
          </Text>
        )}
      </span>
      <Text
        as="span"
        variant={record.basisPerUnitMicros === null ? "supporting" : "primary"}
        className="investment-history__record-value"
      >
        {record.basisPerUnitMicros === null
          ? "Basis unavailable"
          : `${amount(record.basisPerUnitMicros, 6)}/share`}
      </Text>
    </HistoryRecord>
  );
}

const headings: Partial<Record<InvestmentReconciliation["status"], string>> = {
  pending_snapshot: "Activity newer than holdings",
  unexplained_difference: "Unexplained share difference",
  reconciled: "Shares reconciled",
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
  const [draftType, setDraftType] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterTriggerId = useId();
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
  const lotsUnavailable =
    lotPage?.coverage.status === "unavailable" && lotPage.items.length === 0;
  const staleHolding = Boolean(
    snapshotId &&
    reconciliation?.context.holdingsSnapshotId &&
    snapshotId !== reconciliation.context.holdingsSnapshotId,
  );
  const datesInvalid = Boolean(
    draft.from && draft.through && draft.from > draft.through,
  );
  const filtersChanged =
    draftType !== type ||
    draft.from !== dates.from ||
    draft.through !== dates.through;
  const clearFilters = () => {
    setType("all");
    setDraftType("all");
    setDates({ from: "", through: "" });
    setDraft({ from: "", through: "" });
    reset();
  };
  const filterCount =
    (type !== "all" ? 1 : 0) + (dates.from || dates.through ? 1 : 0);
  const coverage = (activityPage?.context ?? reconciliation?.context)?.coverage;
  const outsideCoverage = Boolean(
    coverage &&
    ((dates.from &&
      coverage.requestedFrom &&
      dates.from < coverage.requestedFrom) ||
      (dates.through &&
        coverage.requestedThrough &&
        dates.through > coverage.requestedThrough)),
  );
  const partialCoverage =
    coverage &&
    coverage.status !== "not_synced" &&
    (coverage.status !== "complete" || outsideCoverage);
  const reconciliationHeading =
    reconciliation && headings[reconciliation.status];
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
          {staleHolding && (
            <FormMessage>
              Holdings changed. Reload this holding before comparing activity.
            </FormMessage>
          )}
          {reconciliation.context.lastAttemptStatus === "failed" && (
            <FormMessage tone="error">
              The latest history check failed. Showing the last successful
              history.
            </FormMessage>
          )}
          <Tabs
            value={tab}
            onValueChange={(value) => {
              setTab(String(value));
              setFiltersOpen(false);
              reset();
            }}
          >
            <div className="investment-history__viewbar">
              <TabsList variant="line" aria-label="Investment history views">
                <TabsTrigger value="activity">
                  {account ? "Account activity" : "Activity"}
                </TabsTrigger>
                {!account && <TabsTrigger value="lots">Tax lots</TabsTrigger>}
              </TabsList>
              <Button
                tone="quiet"
                onClick={() => {
                  setAccount((v) => !v);
                  setTab("activity");
                  setFiltersOpen(false);
                  clearFilters();
                }}
              >
                {account ? "Holding activity" : "Account activity"}
              </Button>
            </div>
            <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
              <div className="investment-history__toolbar">
                <Text variant="supporting">
                  {tab === "lots"
                    ? "Remaining lots · Reported basis/share"
                    : "Posting dates · Cash movement"}
                </Text>
                {tab === "lots" ? (
                  lotsUnavailable ? null : (
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
                        <SelectItem value="oldest">
                          Oldest acquisition
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  )
                ) : (
                  <CollapsibleTrigger id={filterTriggerId} layout="inline">
                    Filter{filterCount ? ` · ${filterCount}` : ""}
                    <DisclosureIndicator />
                  </CollapsibleTrigger>
                )}
              </div>
              <CollapsibleContent>
                <form
                  className="investment-history__filters"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!datesInvalid && filtersChanged && !loading) {
                      setType(draftType);
                      setDates(draft);
                      setFiltersOpen(false);
                      document.getElementById(filterTriggerId)?.focus();
                      reset();
                    }
                  }}
                >
                  <Field label="Activity type">
                    {(control) => (
                      <Select
                        value={draftType}
                        onValueChange={(value) =>
                          setDraftType(
                            typeof value === "string" ? value : "all",
                          )
                        }
                      >
                        <SelectTrigger {...control} aria-label="Activity type">
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
                              )[draftType]
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
                  </Field>
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
                  <ActionGroup wrap>
                    <Button
                      tone="primary"
                      type="submit"
                      disabled={datesInvalid || !filtersChanged || loading}
                    >
                      Apply
                    </Button>
                    <Button tone="quiet" onClick={clearFilters}>
                      Clear
                    </Button>
                  </ActionGroup>
                  {datesInvalid && (
                    <FormMessage tone="error">
                      From must be on or before Through.
                    </FormMessage>
                  )}
                </form>
              </CollapsibleContent>
            </Collapsible>
            <div className="investment-history__freshness">
              {reconciliation.context.coverage.lastSuccessfulSyncAt && (
                <Text variant="supporting">
                  Updated{" "}
                  {timestamp(
                    reconciliation.context.coverage.lastSuccessfulSyncAt,
                  )}
                </Text>
              )}
              {tab === "activity" && partialCoverage && (
                <Collapsible>
                  <CollapsibleTrigger layout="inline">
                    Partial history
                    <DisclosureIndicator />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <Text variant="supporting">
                      {outsideCoverage
                        ? "This filter extends beyond available history."
                        : "Some activity is missing."}
                    </Text>
                    {coverage?.requestedFrom && coverage.requestedThrough && (
                      <Text variant="supporting">
                        Requested history · {formatDate(coverage.requestedFrom)}
                        –{formatDate(coverage.requestedThrough)}
                      </Text>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
            {tab === "activity" &&
              !reconciliationHeading &&
              !staleHolding &&
              reconciliation.status !== "not_synced" && (
                <Text variant="supporting">
                  Keel can’t verify which trades are included in the reported
                  shares.
                </Text>
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
                  {activityPage?.items.length ? (
                    <RecordGroup layout="disclosures" aria-label="Transactions">
                      {activityPage.items.map((record) => (
                        <Transaction
                          key={record.id}
                          record={record}
                          account={account}
                        />
                      ))}
                    </RecordGroup>
                  ) : (
                    <>
                      <Text variant="supporting">
                        {reconciliation.status === "not_synced"
                          ? "No activity captured yet."
                          : "No captured activity."}
                      </Text>
                      {filterCount > 0 && (
                        <Button tone="quiet" onClick={clearFilters}>
                          Clear filters
                        </Button>
                      )}
                    </>
                  )}
                </TabsContent>
                <TabsContent value="lots">
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
                      <Text variant="supporting">
                        {shares(lotPage.coverage.coveredQuantityMicros)} of{" "}
                        {shares(lotPage.coverage.reportedQuantityMicros)}{" "}
                        reported shares covered by lots.
                      </Text>
                      {(lotPage.coverage.status !== "complete" ||
                        !lotPage.coverage.allBasisKnown) && (
                        <FormMessage>
                          Higher-cost lots may be missing. Lot or basis coverage
                          is partial.
                        </FormMessage>
                      )}
                      <RecordGroup
                        layout="disclosures"
                        aria-label="Remaining lots"
                      >
                        {lotPage.items.map((record) => (
                          <Lot key={record.id} record={record} />
                        ))}
                      </RecordGroup>
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
          {reconciliationHeading && !staleHolding && (
            <Collapsible className="investment-history__reconciliation">
              <CollapsibleTrigger layout="inline">
                {reconciliationHeading}
                <DisclosureIndicator />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <Text variant="supporting">{reconciliation.reason}</Text>
                {reconciliation.openingQuantityMicros !== null && (
                  <DataList className="investment-history__facts">
                    <DataItem
                      label="Opening shares"
                      value={shares(reconciliation.openingQuantityMicros)}
                    />
                    <DataItem
                      label="Recorded activity"
                      value={shares(reconciliation.activityQuantityMicros)}
                    />
                    <DataItem
                      label="Expected shares"
                      value={shares(reconciliation.expectedQuantityMicros)}
                    />
                    <DataItem
                      label="Reported shares"
                      value={shares(reconciliation.reportedQuantityMicros)}
                    />
                  </DataList>
                )}
                {reconciliation.unexplainedQuantityMicros !== null && (
                  <Text variant="supporting">
                    Unexplained difference ·{" "}
                    {shares(reconciliation.unexplainedQuantityMicros)} shares
                  </Text>
                )}
                {!reconciliation.context.quantityEffectiveOn && (
                  <Text variant="supporting">
                    Quantity effective date unavailable. A price date or refresh
                    time cannot establish trade inclusion.
                  </Text>
                )}
                <Text variant="supporting">
                  Cash is not reconciled. Cost basis remains broker reported.
                </Text>
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </section>
  );
}
