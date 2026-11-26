import {
  dailyCloseProvider,
  type MarketReview,
} from "@keel/domain/market-close";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Holding } from "@keel/domain";
import type { calculatePositionPerformance } from "@keel/domain/position-economics";
import {
  Button,
  ActionGroup,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DisclosureIndicator,
  InfoTip,
  LoadingStatus,
  TextLink,
} from "@keel/ui";
import { investmentFeeAmount } from "@keel/domain/investment-fees";
import {
  carryUnavailableReason,
  holdingValueSummary,
  latestHoldingGpMark,
  signedReturn,
} from "./holding-value";
import { holdingInvestmentHasReadbackFacts } from "./holding-investment-readback";
import { HoldingHistory } from "./HoldingHistory";
import {
  HoldingReturn,
  RelatedHoldingEntities,
  type RelatedPosition,
} from "./HoldingSummaryDetails";
import { positionShareSummary } from "./position-share-summary";
import { HoldingLinkButton } from "./HoldingLinkButton";
import {
  HoldingInvestment,
  type HoldingInvestmentHandle,
} from "./HoldingInvestment";
import { followedCloseReviewPath } from "./holding-position-route";
import { HoldingValuationEditor } from "./HoldingValuation";
import { PositionLinksEditor } from "./PositionLinksEditor";
import {
  capitalSummaryLabel,
  positionCapitalSummary,
} from "./position-capital-summary";
import { formatDate, formatMoney, formatSharePrice } from "./format";
import { decimal } from "./decimal-input";

const ManualHoldingEditor = lazy(async () => {
  const module = await import("./ManualHoldingEditor");
  return { default: module.ManualHoldingEditor };
});

export function SpvHoldingDetail({
  holding,
  valuationRequested,
  onValuationRouteClose,
  marketReview,
  onManualNavigationLockChange,
  companyGroupingAction,
  onAccepted,
  related = [],
}: {
  holding: Holding;
  valuationRequested: boolean;
  onValuationRouteClose: () => void;
  marketReview?: MarketReview | undefined;
  onManualNavigationLockChange?: ((locked: boolean) => void) | undefined;
  companyGroupingAction?: ReactNode;
  onAccepted: () => Promise<void>;
  related?: RelatedPosition[];
}) {
  const [editingHere, setEditingHere] = useState(false);
  const closeReviewPath = followedCloseReviewPath(holding);
  const editing =
    closeReviewPath === null && (valuationRequested || editingHere);
  useEffect(() => {
    if (valuationRequested && closeReviewPath)
      window.location.replace(closeReviewPath);
  }, [valuationRequested, closeReviewPath]);
  const [payment, setPayment] = useState<string | null>(null);
  const [identityEditing, setIdentityEditing] = useState(false);
  const [investmentEditing, setInvestmentEditing] = useState(false);
  const [distributionReadbackPending, setDistributionReadbackPending] =
    useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const acceptedChange = async () => {
    await onAccepted();
    setHistoryRevision((n) => n + 1);
  };
  const heading = useRef<HTMLHeadingElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const identityEdit = useRef<HTMLButtonElement>(null);
  const investmentEditor = useRef<HoldingInvestmentHandle>(null);
  const investmentAction = useRef<HTMLButtonElement>(null);
  const {
    record,
    reviewed,
    capital: carryCapital,
    after,
    beforeReturn,
    afterReturn,
    carry,
    historical,
  } = holdingValueSummary(holding);
  const distributionReview =
    holding.purchaseContext?.receipt?.details.distributionReview;
  const hasCarryInputs =
    carryCapital.capitalBasisMinor !== null ||
    carryCapital.investorDistributionsMinor !== null ||
    carryCapital.capitalRemainingMinor !== null ||
    distributionReview?.priorCarry.status === "known";
  const unpaid =
    holding.purchaseContext?.receipt?.details.lots.flatMap((lot) =>
      (lot.fees ?? [])
        .filter((f) => f.paymentStatus === "unpaid")
        .map((fee) => ({
          ...fee,
          amount: investmentFeeAmount(fee, {
            grossCashMinor: lot.grossCashMinor,
            refundMinor:
              lot.capitalReturn?.status === "received"
                ? lot.capitalReturn.amountMinor
                : 0,
            netCapitalMinor: lot.netCapitalMinor,
          }),
        })),
    ) ?? [];
  const paymentDetail = unpaid.find((f) => f.id === payment);
  const capital = positionCapitalSummary(
    holding.purchaseContext?.receipt,
    holding.purchaseContext?.snapshotId,
  );
  const shares = positionShareSummary(
    holding.purchaseContext,
    Boolean(record?.followSource),
  );
  const shareMetadata = shares && (
    <p className="holding-metadata">
      {shares.estimated && (
        <abbr title="Estimated shares" aria-label="Estimated">
          ≈
        </abbr>
      )}
      {decimal(shares.quantityMicros, 6)}{" "}
      {shares.quantityMicros === 1_000_000 ? "share" : "shares"}
      {shares.asOf && <> · {formatDate(shares.asOf)}</>}
    </p>
  );
  const lots = holding.purchaseContext?.receipt?.details.lots;
  const recordedManualCash =
    holding.manualContext &&
    lots?.length &&
    lots.every((lot) => lot.grossCashMinor !== null)
      ? lots.reduce((total, lot) => total + BigInt(lot.grossCashMinor!), 0n)
      : null;
  const cashPaidMinor = holding.manualContext
    ? recordedManualCash !== null &&
      recordedManualCash <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(recordedManualCash)
      : null
    : (holding.investedMinor ?? null);
  const cashPaidInSummary =
    capital?.amountMinor == null &&
    (holding.manualContext || !record) &&
    cashPaidMinor !== null;
  const omitCashPaid = Boolean(
    holding.manualContext && cashPaidInSummary && lots?.length === 1,
  );
  const hasInvestmentFacts = holdingInvestmentHasReadbackFacts(
    holding,
    omitCashPaid,
  );
  const needsAddInvestment = Boolean(
    holding.manualContext &&
    !hasInvestmentFacts &&
    capital?.amountMinor == null &&
    cashPaidMinor === null,
  );
  const showSummary =
    !holding.manualContext ||
    record !== null ||
    capital?.amountMinor != null ||
    cashPaidMinor !== null ||
    Boolean(shares);
  const investmentEditAction =
    holding.manualContext && !hasInvestmentFacts && !investmentEditing ? (
      <Button
        ref={investmentAction}
        tone="quiet"
        aria-label="Edit investment"
        disabled={editing}
        onClick={() => investmentEditor.current?.edit()}
      >
        Edit
      </Button>
    ) : null;
  const addValuationAction = (
    <Button
      ref={edit}
      tone="quiet"
      disabled={investmentEditing}
      onClick={() => setEditingHere(true)}
    >
      Add valuation
    </Button>
  );
  useEffect(() => {
    if (!editing) heading.current?.focus();
  }, [holding.id, editing]);
  const close = () => {
    setEditingHere(false);
    if (valuationRequested) onValuationRouteClose();
    requestAnimationFrame(() => edit.current?.focus());
  };
  const label =
    record?.origin === "at_cost"
      ? "At cost"
      : record?.origin === "judgment"
        ? holding.manualContext
          ? "Your estimate"
          : "My estimate"
        : record?.origin === "proxy"
          ? `${record.sourceLabel} price proxy`
          : record?.method === "shares" || record?.method === "price_change"
            ? "Estimated value"
            : "Reported value";
  const acceptedClose = holding.purchaseContext?.receipt?.publicClose;
  const closeQuote = acceptedClose ?? marketReview?.quote;
  const followsClose = Boolean(
    acceptedClose && record?.origin === "public_close",
  );
  const closeProvider = closeQuote && dailyCloseProvider(closeQuote);
  const gp = closeQuote
    ? latestHoldingGpMark(
        holding,
        marketReview?.positions.find((p) => p.id === holding.id)?.latestGpPrice,
      )
    : null;
  const sourceDate = record?.effectiveDate;
  const sourceName =
    record &&
    record.origin !== "proxy" &&
    (record.origin !== "judgment" || record.sourceUrl)
      ? record.sourceLabel
      : null;
  const source =
    sourceName &&
    record &&
    (record.sourceUrl ? (
      <TextLink
        className="holding-source-link"
        href={record.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        {sourceName}
      </TextLink>
    ) : (
      sourceName
    ));
  const remainingLabel =
    record?.origin === "at_cost"
      ? "Remaining value at cost"
      : record?.origin === "judgment"
        ? holding.manualContext
          ? "Your estimate of remaining value"
          : "My estimate of remaining value"
        : record?.origin === "proxy"
          ? "Estimated value"
          : record?.method === "shares" || record?.method === "price_change"
            ? "Estimated remaining value"
            : "Reported remaining value";
  const editButton = closeReviewPath ? (
    <TextLink
      href={closeReviewPath}
      aria-label="Change exposure valuation source"
    >
      Change
    </TextLink>
  ) : (
    !editing && (
      <Button
        ref={edit}
        tone="quiet"
        aria-label="Edit valuation"
        disabled={investmentEditing}
        onClick={() => setEditingHere(true)}
      >
        Edit
      </Button>
    )
  );
  const valuationEditor = editing && (
    <HoldingValuationEditor
      key={holding.id}
      holding={holding}
      onAccepted={acceptedChange}
      onSaved={() => {
        if (valuationRequested) {
          // Keep the refresh/retry notice mounted. Reloads should now open the saved position.
          setEditingHere(true);
          onValuationRouteClose();
        }
      }}
      onClose={close}
    />
  );
  const value = (
    amount: number,
    title: string,
    performance: ReturnType<typeof calculatePositionPerformance> | null,
    editable: boolean,
    provenance: boolean,
    info?: string,
  ) => (
    <div className="holding-value-metric" role="group" aria-label={title}>
      <div className="holding-metric-heading">
        {info ? (
          <div className="holding-metric-label">
            <p>{title}</p>
            <InfoTip label={info}>{info}</InfoTip>
          </div>
        ) : (
          <p>{title}</p>
        )}
        {editable && editButton}
      </div>
      <strong className="holding-value-amount">
        {provenance && record?.origin === "proxy" && "≈"}
        {formatMoney(amount)}
      </strong>
      {performance?.totalReturnPpm != null && (
        <HoldingReturn
          percent={signedReturn(performance.totalReturnPpm)}
          accessiblePercent={`Return ${title.toLowerCase().includes("before") ? "before remaining" : "after"} carry ${signedReturn(performance.totalReturnPpm)}`}
          performance={performance}
          estimated={
            record?.origin === "proxy" ||
            record?.origin === "judgment" ||
            record?.method === "shares" ||
            (title.includes("After carry") &&
              record?.carryStatus !== "after_carry") ||
            performance.costBasisSource === "funded_amount_estimate" ||
            performance.costBasisSource === "reviewed_spv_estimate"
          }
          date={provenance ? sourceDate : null}
          formatAmount={formatMoney}
        />
      )}
      {provenance &&
        record?.origin !== "public_close" &&
        (source || (sourceDate && performance?.totalReturnPpm == null)) && (
          <p className="holding-metadata">
            {sourceDate && performance?.totalReturnPpm == null && (
              <>
                <time dateTime={sourceDate}>{formatDate(sourceDate)}</time>
                {source && " · "}
              </>
            )}
            {source}
          </p>
        )}
      {provenance && followsClose && closeQuote && (
        <p className="holding-metadata">
          {record?.method === "price_change"
            ? `Tracks the percentage change in ${closeQuote.ticker}’s close`
            : acceptedClose?.proxyBasis?.method === "indicative_shares"
              ? `Uses ${closeQuote.ticker}’s close as a 1:1 price proxy`
              : `Based on ${closeQuote.ticker}’s ${closeProvider ? "daily close" : "closing price"}`}
        </p>
      )}
      {provenance &&
        record?.origin === "proxy" &&
        holding.purchaseContext?.priceProxyStatus?.stale && (
          <p className="holding-metadata">Using last valid price</p>
        )}
      {title.includes("After carry") &&
        unpaid.map((f) => (
          <p className="holding-metadata" key={f.id}>
            Excludes {f.amount !== null ? `${formatMoney(f.amount)} ` : ""}
            unpaid {f.label.toLowerCase()}
          </p>
        ))}
    </div>
  );
  if (identityEditing)
    return (
      <Suspense
        fallback={<LoadingStatus>Loading holding editor…</LoadingStatus>}
      >
        <ManualHoldingEditor
          holding={holding}
          onClose={() => {
            setIdentityEditing(false);
            requestAnimationFrame(() => identityEdit.current?.focus());
          }}
          onNavigationLockChange={onManualNavigationLockChange}
          onSaved={async () => {
            await acceptedChange();
            setIdentityEditing(false);
            requestAnimationFrame(() => identityEdit.current?.focus());
          }}
        />
      </Suspense>
    );
  if (paymentDetail)
    return (
      <section
        className="holding-detail-workspace spv-holding"
        aria-label="Payment details"
      >
        <Button tone="quiet" onClick={() => setPayment(null)}>
          Back to holding
        </Button>
        <h2>Payment details</h2>
        <p>{holding.positionName}</p>
        <DataList layout="rows">
          <DataItem
            label={paymentDetail.label}
            value={
              paymentDetail.amount === null
                ? "Amount unknown"
                : formatMoney(paymentDetail.amount)
            }
          />
          <DataItem
            label="Due"
            value={
              paymentDetail.dueDate
                ? formatDate(paymentDetail.dueDate)
                : "Date unknown"
            }
          />
          <DataItem label="Status" value="Unpaid" />
        </DataList>
      </section>
    );
  return (
    <section
      className="holding-detail-workspace spv-holding"
      aria-labelledby="holding-detail-title"
    >
      <header className="holding-detail-heading">
        <div className="holding-detail-title">
          <h2 id="holding-detail-title" ref={heading} tabIndex={-1}>
            {holding.manualContext
              ? holding.positionName
              : (holding.exposureName ??
                holding.acceptedLegalName ??
                holding.positionName)}
          </h2>
          <HoldingLinkButton kind="position" id={holding.id} icon />
        </div>
        <p className="holding-metadata">
          {holding.manualContext
            ? holding.positionKind === "direct"
              ? "Direct"
              : holding.positionKind === "fund_interest"
                ? "Fund"
                : "SPV"
            : (holding.acceptedLegalName ?? holding.positionName)}{" "}
          · {holding.ownerLabel}
        </p>
        {holding.manualContext && (
          <>
            <p className="holding-metadata">Entered by you</p>
            <Button
              ref={identityEdit}
              tone="quiet"
              disabled={editing || investmentEditing}
              onClick={() => setIdentityEditing(true)}
            >
              Edit holding details
            </Button>
          </>
        )}
        <RelatedHoldingEntities positions={related} />
      </header>
      {companyGroupingAction}
      {distributionReadbackPending ? (
        <p role="status" className="distribution-result-limit">
          Distributions were saved. Updated values and returns will appear after
          reload.
        </p>
      ) : (
        <>
          {investmentEditing && <p className="eyebrow">Saved values</p>}
          {showSummary && (
            <section
              aria-label="Position summary"
              className="holding-value-summary"
            >
              {record?.carryStatus === "before_carry" &&
                value(
                  record.valueMinor,
                  record.origin === "proxy"
                    ? "Before carry"
                    : `${remainingLabel} · Before carry`,
                  beforeReturn,
                  true,
                  true,
                  record.origin === "proxy" ? "Estimated value" : undefined,
                )}
              {after &&
                value(
                  after.proceedsMinor,
                  `${record?.carryStatus === "after_carry" ? remainingLabel : "Estimated remaining value"} · After carry`,
                  afterReturn,
                  record?.carryStatus === "after_carry",
                  record?.carryStatus === "after_carry",
                )}
              {record?.carryStatus === "unknown" &&
                value(
                  record.valueMinor,
                  `${remainingLabel} · Carry unspecified`,
                  null,
                  true,
                  true,
                )}
              {capital?.amountMinor != null ? (
                <div
                  role="group"
                  aria-label="Invested capital"
                  className="holding-value-metric"
                >
                  {investmentEditAction ? (
                    <div className="holding-metric-heading">
                      <p>{capitalSummaryLabel(capital)}</p>
                      {investmentEditAction}
                    </div>
                  ) : (
                    <p>{capitalSummaryLabel(capital)}</p>
                  )}
                  <strong className="holding-value-amount">
                    {formatMoney(capital.amountMinor)}
                  </strong>
                  {shareMetadata}
                </div>
              ) : (holding.manualContext || !record) &&
                cashPaidMinor !== null ? (
                <div
                  className="holding-value-metric"
                  role="group"
                  aria-label="Cash paid"
                >
                  {investmentEditAction ? (
                    <div className="holding-metric-heading">
                      <p>Cash paid</p>
                      {investmentEditAction}
                    </div>
                  ) : (
                    <p>Cash paid</p>
                  )}
                  <strong className="holding-value-amount">
                    {formatMoney(cashPaidMinor)}
                  </strong>
                  {shareMetadata}
                </div>
              ) : shareMetadata ? (
                <div className="holding-share-only">{shareMetadata}</div>
              ) : null}
            </section>
          )}
          {closeQuote && (
            <DataList
              layout="rows"
              aria-label="Valuation sources"
              className="holding-price-sources"
            >
              <DataItem
                label={`${closeQuote.ticker} ${closeProvider ? "daily close" : "closing price"}${followsClose ? "" : " (reference)"}`}
                value={
                  <>
                    {formatSharePrice(closeQuote.priceMicros)}/share
                    <small className="holding-metadata">
                      {formatDate(closeQuote.date)} · {closeQuote.venue}
                      {closeProvider && ` via ${closeProvider}`}
                    </small>
                  </>
                }
              />
              <DataItem
                label="Latest GP mark"
                value={
                  gp ? (
                    <>
                      {gp.unit === "share"
                        ? formatSharePrice(gp.value) + "/share"
                        : formatMoney(gp.value)}
                      <small className="holding-metadata">
                        {gp.date ? formatDate(gp.date) : "Date unavailable"} ·{" "}
                        {gp.source}
                      </small>
                    </>
                  ) : (
                    "Unavailable"
                  )
                }
              />
            </DataList>
          )}
          {needsAddInvestment && !editing && !investmentEditing && (
            <ActionGroup className="holding-detail-actions">
              <Button
                ref={investmentAction}
                tone="quiet"
                onClick={() => investmentEditor.current?.edit()}
              >
                Add investment details
              </Button>
              {!record && addValuationAction}
            </ActionGroup>
          )}
          {!record && !needsAddInvestment ? (
            <section
              className="holding-valuation-section"
              aria-labelledby="holding-valuation-heading"
            >
              <div className="holding-section-heading">
                <h3 id="holding-valuation-heading">Valuation</h3>
                {!editing && addValuationAction}
              </div>
              {valuationEditor}
            </section>
          ) : editing ? (
            valuationEditor
          ) : null}
          {!editing && (record || hasCarryInputs) && (
            <Collapsible className="holding-calculation">
              <CollapsibleTrigger layout="inline">
                Calculation
                <DisclosureIndicator />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <DataList layout="rows">
                  {record && (
                    <DataItem
                      label={label}
                      value={formatMoney(record.valueMinor)}
                    />
                  )}
                  {record?.method === "shares" && (
                    <DataItem
                      label="Shares × price"
                      value={`${decimal(record.quantityMicros, 6)} × ${formatSharePrice(record.priceMicros!)}`}
                    />
                  )}
                  {record?.method === "price_change" &&
                    acceptedClose?.proxyBasis?.method === "price_change" && (
                      <>
                        <DataItem
                          label="Starting SPV value"
                          value={[
                            formatMoney(acceptedClose.proxyBasis.startMinor),
                            acceptedClose.proxyBasis.valueDate &&
                              formatDate(acceptedClose.proxyBasis.valueDate),
                            acceptedClose.proxyBasis.sourceLabel,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        />
                        <DataItem
                          label="Starting close"
                          value={`${formatSharePrice(acceptedClose.proxyBasis.startPriceMicros)}/share · ${formatDate(acceptedClose.proxyBasis.startDate)}`}
                        />
                      </>
                    )}
                  {record?.origin === "proxy" && (
                    <DataItem
                      label="Price source"
                      value={
                        <>
                          {record.sourceUrl ? (
                            <TextLink
                              href={record.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {record.sourceLabel}
                            </TextLink>
                          ) : (
                            record.sourceLabel
                          )}
                          {record.crossClassProxy
                            ? " · Cross-class proxy"
                            : " · Price proxy"}
                        </>
                      }
                    />
                  )}
                  {record?.origin === "proxy" && record.sourceContinuation && (
                    <>
                      {!record.shareClass && (
                        <DataItem
                          label="Assumed share class"
                          value={record.sourceContinuation.shareClass}
                        />
                      )}
                      {!record.shareBasis && (
                        <DataItem
                          label="Assumed shares per original share"
                          value={
                            record.sourceContinuation.shareBasis
                              .unitsPerOriginal
                          }
                        />
                      )}
                    </>
                  )}
                  {carryCapital.capitalBasisMinor !== null && (
                    <DataItem
                      label="Contributed-capital hurdle"
                      value={formatMoney(carryCapital.capitalBasisMinor)}
                    />
                  )}
                  {reviewed?.terms.carryBasis &&
                    reviewed.terms.carryBasis !== "unknown" && (
                      <DataItem
                        label="Carry basis"
                        value={
                          reviewed.terms.carryBasis === "gross_cash"
                            ? "Cash after refunds"
                            : "Net capital"
                        }
                      />
                    )}
                  {carryCapital.investorDistributionsMinor !== null && (
                    <DataItem
                      label="Received distributions at historical value"
                      value={formatMoney(
                        carryCapital.investorDistributionsMinor,
                      )}
                    />
                  )}
                  {carryCapital.capitalRemainingMinor !== null && (
                    <DataItem
                      label="Capital still to return"
                      value={formatMoney(carryCapital.capitalRemainingMinor)}
                    />
                  )}
                  {distributionReview?.priorCarry.status === "known" && (
                    <DataItem
                      label="Carry already charged"
                      value={formatMoney(
                        distributionReview.priorCarry.amountMinor,
                      )}
                    />
                  )}
                  {after?.carryMinor != null && (
                    <DataItem
                      label="Estimated carry"
                      value={formatMoney(after.carryMinor)}
                    />
                  )}
                  {carry.status === "unavailable" &&
                    (historical.status !== "unavailable" ||
                      carry.reason !== historical.reason) && (
                      <DataItem
                        label="Carry estimate"
                        value={carryUnavailableReason(carry.reason)}
                      />
                    )}
                  {(beforeReturn?.costBasisMinor ??
                    afterReturn?.costBasisMinor) != null && (
                    <DataItem
                      label={
                        (beforeReturn?.costBasisSource ??
                          afterReturn?.costBasisSource) ===
                        "reviewed_spv_estimate"
                          ? "Estimated net capital"
                          : "Net capital"
                      }
                      value={formatMoney(
                        (beforeReturn?.costBasisMinor ??
                          afterReturn?.costBasisMinor)!,
                      )}
                    />
                  )}
                  {historical.status === "available" &&
                    historical.netDistributionsMinor > 0 && (
                      <DataItem
                        label="Distributions excluding capital refunds"
                        value={formatMoney(historical.netDistributionsMinor)}
                      />
                    )}
                  {(reviewed?.includedReturnedCapitalMinor ?? 0) > 0 && (
                    <DataItem
                      label="Capital refunds in distributions"
                      value={formatMoney(
                        reviewed!.includedReturnedCapitalMinor!,
                      )}
                    />
                  )}
                </DataList>
                {after?.method === "legacy_remaining_only" && (
                  <p className="holding-metadata">
                    Carry is estimated from the remaining value only.
                  </p>
                )}
                {after?.method === "cumulative" && (
                  <p className="holding-metadata">
                    Only investor distributions reduce capital still to return.
                    The carry calculation includes historical investor value and
                    deducts carry already charged.
                  </p>
                )}
                {(beforeReturn?.totalReturnPpm != null ||
                  afterReturn?.totalReturnPpm != null) && (
                  <p className="holding-metadata">
                    Total return = (value + distributions excluding capital
                    refunds − net capital) ÷ net capital
                  </p>
                )}
                {historical.status === "unavailable" && (
                  <p>
                    Total return unavailable.{" "}
                    {carryUnavailableReason(historical.reason)}
                  </p>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
      {unpaid.map((f) => (
        <div
          className="holding-section-heading holding-payment-summary"
          key={f.id}
        >
          <div>
            <h3>
              {f.label}
              {f.amount !== null ? ` · ${formatMoney(f.amount)}` : ""}
            </h3>
            <p className="holding-metadata">
              {f.dueDate ? `Due ${formatDate(f.dueDate)} · ` : ""}Unpaid
            </p>
          </div>
          <Button tone="quiet" onClick={() => setPayment(f.id)}>
            Review payment
          </Button>
        </div>
      ))}
      <HoldingInvestment
        key={holding.id}
        holding={holding}
        editorRef={investmentEditor}
        omitCashPaid={omitCashPaid}
        disabled={editing}
        onAccepted={acceptedChange}
        onReadbackPendingChange={setDistributionReadbackPending}
        onEditingChange={(open) => {
          setInvestmentEditing(open);
          if (!open && holding.manualContext)
            requestAnimationFrame(() => investmentAction.current?.focus());
        }}
      />
      <fieldset
        className="holding-form-fieldset holding-linked-records"
        disabled={editing || investmentEditing}
      >
        <PositionLinksEditor
          positionId={holding.id}
          hasLinkedRecords={holding.hasLinkedRecords ?? false}
          onAccepted={acceptedChange}
          presentation="section"
        />
      </fieldset>
      <Collapsible className="holding-history">
        <CollapsibleTrigger layout="inline">
          <h3>Sources &amp; history</h3>
          <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="holding-metadata">
            {holding.sourceLabel} · {holding.manualContext ? "Recorded " : ""}
            {formatDate(
              holding.manualContext
                ? holding.retrievedAt.slice(0, 10)
                : holding.effectiveDate,
            )}
          </p>
          <HoldingHistory
            key={`${holding.id}:${historyRevision}`}
            positionId={holding.id}
          />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
