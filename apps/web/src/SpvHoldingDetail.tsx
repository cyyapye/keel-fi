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
  LoadingStatus,
  TextLink,
} from "@keel/ui";
import { investmentFeeAmount } from "@keel/domain/investment-fees";
import { holdingValueSummary, signedReturn } from "./holding-value";
import { holdingInvestmentHasReadbackFacts } from "./holding-investment-readback";
import { HoldingHistory } from "./HoldingHistory";
import { HoldingLinkButton } from "./HoldingLinkButton";
import {
  HoldingInvestment,
  type HoldingInvestmentHandle,
} from "./HoldingInvestment";
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
  onManualNavigationLockChange,
  companyGroupingAction,
  onAccepted,
  related = [],
}: {
  holding: Holding;
  onManualNavigationLockChange?: ((locked: boolean) => void) | undefined;
  companyGroupingAction?: ReactNode;
  onAccepted: () => Promise<void>;
  related?: Holding[];
}) {
  const [payment, setPayment] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [identityEditing, setIdentityEditing] = useState(false);
  const [investmentEditing, setInvestmentEditing] = useState(false);
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
  const { record, reviewed, after, beforeReturn, afterReturn } =
    holdingValueSummary(holding);
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
    cashPaidMinor !== null;
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
      tone="quiet"
      disabled={investmentEditing}
      onClick={() => setEditing(true)}
    >
      Add valuation
    </Button>
  );
  useEffect(() => {
    heading.current?.focus();
  }, [holding.id]);
  const close = () => {
    setEditing(false);
    requestAnimationFrame(() => edit.current?.focus());
  };
  const label =
    record?.origin === "judgment"
      ? holding.manualContext
        ? "Your estimate"
        : "My estimate"
      : record?.origin === "proxy"
        ? `${record.sourceLabel} price proxy`
        : record?.method === "shares"
          ? "Estimated value"
          : "Reported value";
  const source = record && (
    <p className="holding-metadata">
      {formatDate(record.effectiveDate)}
      {record.origin !== "judgment" && record.origin !== "proxy"
        ? ` · ${record.sourceLabel}`
        : ""}
      {record.origin === "proxy" &&
      "estimatedShares" in record &&
      record.estimatedShares
        ? " · Estimated shares"
        : ""}
    </p>
  );
  const editButton = !editing && (
    <Button
      ref={edit}
      tone="quiet"
      aria-label="Edit valuation"
      disabled={investmentEditing}
      onClick={() => setEditing(true)}
    >
      Edit
    </Button>
  );
  const value = (
    amount: number,
    title: string,
    performance: ReturnType<typeof calculatePositionPerformance> | null,
    editable: boolean,
    provenance: boolean,
  ) => (
    <div className="holding-value-metric" role="group" aria-label={title}>
      <div className="holding-metric-heading">
        <p>{title}</p>
        {editable && editButton}
      </div>
      <strong className="holding-value-amount">{formatMoney(amount)}</strong>
      {performance?.totalReturnPpm != null && (
        <strong
          className="holding-value-return"
          aria-label={`Return ${title.toLowerCase().includes("before") ? "before" : "after"} carry ${signedReturn(performance.totalReturnPpm)}`}
        >
          {signedReturn(performance.totalReturnPpm)}
        </strong>
      )}
      {provenance && source}
      {provenance && record?.origin === "proxy" && record.crossClassProxy && (
        <p className="holding-metadata">
          Indicative cross-class proxy · Security rights may differ
        </p>
      )}
      {provenance && holding.purchaseContext?.priceProxyStatus && (
        <p className="holding-metadata">
          {holding.purchaseContext.priceProxyStatus.stale
            ? "Stale source · Last valid estimate retained. "
            : ""}
          Observed{" "}
          {formatDate(
            holding.purchaseContext.priceProxyStatus.lastObservationAt.slice(
              0,
              10,
            ),
          )}
          {holding.purchaseContext.priceProxyStatus.lastSuccessfulSyncAt
            ? ` · Last sync ${formatDate(holding.purchaseContext.priceProxyStatus.lastSuccessfulSyncAt.slice(0, 10))}`
            : ""}
        </p>
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
              : (holding.exposureName ?? holding.positionName)}
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
            : holding.positionName}{" "}
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
        {related.length === 1 && (
          <p className="holding-related holding-metadata">
            Also held through{" "}
            <TextLink
              href={`/holdings?position=${encodeURIComponent(related[0]!.id)}`}
            >
              {related[0]!.positionName}
            </TextLink>
          </p>
        )}
        {related.length > 1 && (
          <div className="holding-related holding-metadata">
            <p>Also held through</p>
            <ul role="list" aria-label="Also held through">
              {related.map((item) => (
                <li key={item.id}>
                  <TextLink
                    href={`/holdings?position=${encodeURIComponent(item.id)}`}
                  >
                    {item.positionName}
                  </TextLink>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>
      {companyGroupingAction}
      {showSummary && (
        <section
          aria-label="Position summary"
          className="holding-value-summary"
        >
          {record?.carryStatus === "before_carry" &&
            value(
              record.valueMinor,
              `${label} · Before carry`,
              beforeReturn,
              true,
              true,
            )}
          {after &&
            value(
              after.proceedsMinor,
              `${record?.carryStatus === "after_carry" ? label : "Estimated value"} · After carry`,
              afterReturn,
              record?.carryStatus === "after_carry",
              record?.carryStatus === "after_carry",
            )}
          {record?.carryStatus === "unknown" &&
            value(
              record.valueMinor,
              `${label} · Carry unspecified`,
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
            </div>
          ) : (holding.manualContext || !record) && cashPaidMinor !== null ? (
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
            </div>
          ) : null}
        </section>
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
      {editing ? (
        <HoldingValuationEditor
          key={holding.id}
          holding={holding}
          onAccepted={acceptedChange}
          onClose={close}
        />
      ) : !record ? (
        needsAddInvestment ? null : (
          addValuationAction
        )
      ) : (
        <Collapsible className="holding-calculation">
          <CollapsibleTrigger layout="inline">
            Calculation
            <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <DataList layout="rows">
              <DataItem label={label} value={formatMoney(record.valueMinor)} />
              {record.method === "shares" && (
                <DataItem
                  label="Shares × price"
                  value={`${decimal(record.quantityMicros, 6)} × ${formatSharePrice(record.priceMicros!)}`}
                />
              )}
              {after?.carryMinor != null && (
                <DataItem
                  label="Estimated carry"
                  value={formatMoney(after.carryMinor)}
                />
              )}
              {(beforeReturn?.costBasisMinor ?? afterReturn?.costBasisMinor) !=
                null && (
                <DataItem
                  label={
                    (beforeReturn?.costBasisSource ??
                      afterReturn?.costBasisSource) === "reviewed_spv_estimate"
                      ? "Estimated net capital"
                      : "Net capital"
                  }
                  value={formatMoney(
                    (beforeReturn?.costBasisMinor ??
                      afterReturn?.costBasisMinor)!,
                  )}
                />
              )}
              {(holding.realizedValueMinor ?? 0) > 0 && (
                <DataItem
                  label="Reported distributions"
                  value={formatMoney(holding.realizedValueMinor!)}
                />
              )}
              {(reviewed?.includedReturnedCapitalMinor ?? 0) > 0 && (
                <DataItem
                  label="Capital refunds in distributions"
                  value={formatMoney(reviewed!.includedReturnedCapitalMinor!)}
                />
              )}
            </DataList>
            {(beforeReturn?.totalReturnPpm != null ||
              afterReturn?.totalReturnPpm != null) && (
              <p className="holding-metadata">
                (Value + distributions
                {(reviewed?.includedReturnedCapitalMinor ?? 0) > 0
                  ? " − capital refunds in distributions"
                  : ""}{" "}
                − net capital) ÷ net capital
              </p>
            )}
            {reviewed?.returnedCapitalReconciliationPending && (
              <p>
                Refund inclusion in reported distributions is unknown. Review it
                in Investment to calculate return.
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
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
        key={`${holding.id}:${holding.purchaseContext?.receipt?.id ?? "new"}`}
        holding={holding}
        editorRef={investmentEditor}
        omitCashPaid={omitCashPaid}
        disabled={editing}
        onAccepted={acceptedChange}
        onEditingChange={(open) => {
          setInvestmentEditing(open);
          if (!open && holding.manualContext)
            requestAnimationFrame(() => investmentAction.current?.focus());
        }}
      />
      <Collapsible className="holding-history">
        <CollapsibleTrigger
          layout="inline"
          disabled={editing || investmentEditing}
        >
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
          <PositionLinksEditor
            positionId={holding.id}
            onAccepted={acceptedChange}
          />
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
