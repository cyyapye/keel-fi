import {
  readExample,
  saveExample,
  exampleReadback,
} from "./holding-maintenance-fixture";
import { useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  DataItem,
  DataList,
  SectionHeader,
} from "@keel/ui";
import { HoldingInvestment } from "../../apps/web/src/HoldingInvestment";
import { HoldingReturn } from "../../apps/web/src/HoldingSummaryDetails";
import {
  holdingValueSummary,
  signedReturn,
} from "../../apps/web/src/holding-value";
import { formatDate, formatMoney } from "../../apps/web/src/format";
import { decimal } from "../../apps/web/src/decimal-input";
import {
  capitalSummaryLabel,
  positionCapitalSummary,
} from "../../apps/web/src/position-capital-summary";
import { positionShareSummary } from "../../apps/web/src/position-share-summary";
import {
  purchaseDetailProjection,
  purchaseDetailReceipt,
} from "../purchase-detail-fixtures";
import {
  AcceptDistributionsSchema,
  normalizePurchaseLotFees,
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
} from "../../packages/domain/src/position-purchases";
import {
  MaintenanceControls,
  ExampleSelect,
} from "./holding-maintenance-controls";

const receiptKey = "keel-ui:holding-maintenance:purchases:v2";
const outcomes = [
  "Read saved holding",
  "Updated holding fails to load once",
] as const;
type Outcome = (typeof outcomes)[number];

function initialPurchase() {
  const initial = purchaseDetailReceipt();
  const evidence = {
    sourceLabel: "Synthetic distribution notice",
    sourceUrl: null,
    note: "",
  };
  return PurchaseReceiptSchema.parse({
    ...initial,
    details: {
      ...initial.details,
      // This statement evidences paid amounts and the prepaid period only.
      // Correcting cash paid does not change either fee already paid.
      lots: initial.details.lots.map((lot) => ({
        ...lot,
        fees: lot.fees?.map((fee) => ({
          ...fee,
          ratePpm: null,
          basis: "unknown",
        })),
      })),
      distributionReview: {
        ...evidence,
        method: "capital_return_first_v1",
        events: [
          {
            ...evidence,
            id: "cash-distribution",
            kind: "cash",
            receivedOn: "2026-08-01",
            investorValueMinor: 150_000,
          },
        ],
        coverage: { status: "complete", throughDate: "2026-09-30" },
        priorCarry: { status: "known", amountMinor: 0 },
        provider: {
          inclusion: "none",
          sourceSnapshotId: initial.snapshotId,
          realizedValueMinor: 0,
        },
      },
    },
  });
}

function readPurchase() {
  return readExample(receiptKey, PurchaseReceiptSchema, initialPurchase);
}

function InvestmentCalculation({
  summary,
}: {
  summary: ReturnType<typeof holdingValueSummary>;
}) {
  const { beforeReturn, afterReturn, after, capital, historical, reviewed } =
    summary;
  const performance = beforeReturn ?? afterReturn;
  return (
    <Collapsible className="holding-calculation">
      <CollapsibleTrigger layout="inline">
        Calculation <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <DataList layout="rows">
          {performance?.costBasisMinor != null && (
            <DataItem
              label={
                performance.costBasisSource === "reviewed_spv_estimate"
                  ? "Estimated net capital"
                  : "Net capital"
              }
              value={formatMoney(performance.costBasisMinor)}
            />
          )}
          {historical.status === "available" && (
            <DataItem
              label="Distributions excluding capital refunds"
              value={formatMoney(historical.netDistributionsMinor)}
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
          {capital.capitalBasisMinor !== null && (
            <DataItem
              label="Contributed-capital hurdle"
              value={formatMoney(capital.capitalBasisMinor)}
            />
          )}
          {capital.investorDistributionsMinor !== null && (
            <DataItem
              label="Received distributions at historical value"
              value={formatMoney(capital.investorDistributionsMinor)}
            />
          )}
          {capital.capitalRemainingMinor !== null && (
            <DataItem
              label="Capital still to return"
              value={formatMoney(capital.capitalRemainingMinor)}
            />
          )}
          {reviewed?.distributionReview?.priorCarry.status === "known" && (
            <DataItem
              label="Carry already charged"
              value={formatMoney(
                reviewed.distributionReview.priorCarry.amountMinor,
              )}
            />
          )}
          {after?.carryMinor != null && (
            <DataItem
              label="Estimated carry"
              value={formatMoney(after.carryMinor)}
            />
          )}
        </DataList>
        {after?.method === "cumulative" && (
          <p className="holding-metadata">
            Only investor distributions reduce capital still to return. The
            carry calculation includes historical investor value and deducts
            carry already charged.
          </p>
        )}
        {performance?.totalReturnPpm != null && (
          <p className="holding-metadata">
            Total return = (value + distributions excluding capital refunds −
            net capital) ÷ net capital
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function HoldingCorrectionsWalkthrough({ terms }: { terms: boolean }) {
  const [receipt, setReceipt] = useState(readPurchase);
  const [outcome, setOutcome] = useState<Outcome>(outcomes[0]);
  const failedReadback = useRef(false);
  const [readbackPending, setReadbackPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const holding = purchaseDetailProjection(receipt).holdings[0]!;
  const summary = holdingValueSummary(holding);
  const capital = positionCapitalSummary(
    receipt,
    holding.purchaseContext?.snapshotId,
  );
  const shares = positionShareSummary(
    holding.purchaseContext,
    Boolean(summary.record?.followSource),
  );
  const request: typeof fetch = async (path, init) => {
    const current = readPurchase();
    const prefix =
      "/api/investment-positions/" + encodeURIComponent(holding.id) + "/";
    if (init?.method !== "POST")
      throw new Error("Unknown sample investment action.");
    const body: unknown = await new Response(init.body).json();
    const distribution = path === prefix + "distributions";
    const change = distribution
      ? AcceptDistributionsSchema.parse(body)
      : AcceptPurchasesSchema.parse(body);
    if (!distribution && path !== prefix + "purchases")
      throw new Error("Unknown sample investment action.");
    if (
      change.expectedSnapshotId !== current.snapshotId ||
      change.expectedReceiptId !== current.id
    )
      return Response.json(
        { error: "The investment changed. Reopen the current position." },
        { status: 409 },
      );
    if (
      "distributionReview" in change &&
      change.distributionReview.coverage.throughDate >
        new Date().toISOString().slice(0, 10)
    )
      return Response.json(
        { error: "Distribution history cannot be dated in the future." },
        { status: 400 },
      );
    const details =
      "distributionReview" in change
        ? { ...current.details, distributionReview: change.distributionReview }
        : change.details;
    if ("details" in change) {
      const fees = normalizePurchaseLotFees(change.details.lots);
      if (!fees.ok)
        return Response.json({ error: fees.error }, { status: 400 });
      details.lots = fees.lots;
      details.investmentSnapshotId = current.snapshotId;
      if (current.details.valuation)
        details.valuation = current.details.valuation;
      if (current.details.distributionReview)
        details.distributionReview = current.details.distributionReview;
    }
    const next = PurchaseReceiptSchema.parse({
      ...current,
      id: crypto.randomUUID(),
      acceptedAt: new Date().toISOString(),
      details,
    });
    saveExample(receiptKey, next);
    failedReadback.current = distribution && outcome === outcomes[1];
    return Response.json(next);
  };
  return (
    <>
      <section
        className="holding-detail-workspace spv-holding"
        aria-label="Selected position"
      >
        <SectionHeader
          title={holding.exposureName ?? holding.positionName}
          description={holding.positionName + " · " + holding.ownerLabel}
        />
        {editing && !readbackPending && <p className="eyebrow">Saved values</p>}
        {readbackPending ? (
          <p role="status" className="distribution-result-limit">
            Distributions were saved. Updated values and returns will appear
            after reload.
          </p>
        ) : (
          <section
            className="holding-value-summary"
            aria-label="Position summary"
          >
            {[
              {
                label: "Reported remaining value · Before carry",
                amount: summary.record?.valueMinor,
                performance: summary.beforeReturn,
                date: summary.record?.effectiveDate,
                source: summary.record?.sourceLabel,
                estimated: false,
              },
              {
                label: "Estimated remaining value · After carry",
                amount: summary.after?.proceedsMinor,
                performance: summary.afterReturn,
                date: null,
                source: null,
                estimated: true,
              },
            ].map(({ label, amount, performance, date, source, estimated }) =>
              amount == null ? null : (
                <div
                  key={label}
                  className="holding-value-metric"
                  role="group"
                  aria-label={label}
                >
                  <div className="holding-metric-heading">
                    <p>{label}</p>
                  </div>
                  <strong className="holding-value-amount">
                    {formatMoney(amount)}
                  </strong>
                  {performance?.totalReturnPpm != null && (
                    <HoldingReturn
                      percent={signedReturn(performance.totalReturnPpm)}
                      performance={performance}
                      estimated={estimated}
                      formatAmount={formatMoney}
                      date={date}
                    />
                  )}
                  {source && <p className="holding-metadata">{source}</p>}
                </div>
              ),
            )}
            {capital?.amountMinor != null && (
              <div
                className="holding-value-metric"
                role="group"
                aria-label="Invested capital"
              >
                <p>{capitalSummaryLabel(capital)}</p>
                <strong className="holding-value-amount">
                  {formatMoney(capital.amountMinor)}
                </strong>
                {shares && (
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
                )}
              </div>
            )}
          </section>
        )}
        {!readbackPending && <InvestmentCalculation summary={summary} />}
        <HoldingInvestment
          holding={holding}
          disabled={false}
          request={request}
          onEditingChange={setEditing}
          onReadbackPendingChange={setReadbackPending}
          onAccepted={async () => {
            await exampleReadback();
            if (failedReadback.current) {
              failedReadback.current = false;
              throw new Error("The saved holding is temporarily unavailable.");
            }
            setReceipt(readPurchase());
          }}
        />
      </section>
      <MaintenanceControls>
        {!terms && (
          <ExampleSelect
            label="Distribution readback"
            choices={outcomes}
            value={outcome}
            onChange={setOutcome}
          />
        )}
        <p className="catalogue-note">
          The sample subscription and distribution receipts belong to Demo Cedar
          SPV. Changes stay in this tab.
        </p>
      </MaintenanceControls>
    </>
  );
}
