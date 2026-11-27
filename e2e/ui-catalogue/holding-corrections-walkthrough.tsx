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
import { PositionEconomicsEditor } from "../../apps/web/src/PositionEconomicsEditor";
import { HoldingInvestment } from "../../apps/web/src/HoldingInvestment";
import { HoldingReturn } from "../../apps/web/src/HoldingSummaryDetails";
import {
  holdingValueSummary,
  signedReturn,
} from "../../apps/web/src/holding-value";
import { formatMoney } from "../../apps/web/src/format";
import { beaconEconomicsContext } from "../holdings-detail-fixtures";
import {
  purchaseDetailProjection,
  purchaseDetailReceipt,
} from "../purchase-detail-fixtures";
import {
  AcceptDistributionsSchema,
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
} from "../../packages/domain/src/position-purchases";
import {
  PositionEconomicsTermsSchema,
  type AcceptPositionEconomicsInput,
} from "../../packages/domain/src/position-economics";
import {
  MaintenanceControls,
  ExampleSelect,
} from "./holding-maintenance-controls";

const receiptKey = "keel-ui:holding-maintenance:purchases:v1";
const termsKey = "keel-ui:holding-maintenance:terms:v1";
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
  const { beforeReturn, afterReturn, after, historical } = summary;
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
          {after?.carryMinor != null && (
            <DataItem
              label="Estimated carry"
              value={formatMoney(after.carryMinor)}
            />
          )}
        </DataList>
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

function InvestmentExample() {
  const [receipt, setReceipt] = useState(readPurchase);
  const [outcome, setOutcome] = useState<Outcome>(outcomes[0]);
  const failedReadback = useRef(false);
  const [readbackPending, setReadbackPending] = useState(false);
  const holding = purchaseDetailProjection(receipt).holdings[0]!;
  const summary = holdingValueSummary(holding);
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
    const details =
      "distributionReview" in change
        ? { ...current.details, distributionReview: change.distributionReview }
        : change.details;
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
          </section>
        )}
        {!readbackPending && <InvestmentCalculation summary={summary} />}
        <HoldingInvestment
          holding={holding}
          disabled={false}
          request={request}
          onEditingChange={() => {}}
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
        <ExampleSelect
          label="Distribution readback"
          choices={outcomes}
          value={outcome}
          onChange={setOutcome}
        />
        <p className="catalogue-note">
          Investment and distribution changes update this tab’s sample position.
          The saved readback uses the reviewed purchases and distributions.
        </p>
      </MaintenanceControls>
    </>
  );
}

function FeeTermsExample() {
  const read = () =>
    readExample(termsKey, PositionEconomicsTermsSchema.nullable(), () => null);
  const [terms, setTerms] = useState(read);
  const id = "holding_demo_spv";
  const holding = {
    id,
    sourceLabel: "Sydecar template",
    purchaseContext: null,
    positionEconomicsContext: {
      ...beaconEconomicsContext,
      acceptedTerms: terms,
    },
  };
  const accept = async (
    positionId: string,
    input: AcceptPositionEconomicsInput,
  ) => {
    await exampleReadback();
    if (
      positionId !== id ||
      input.expectedSnapshotId !== beaconEconomicsContext.snapshotId ||
      input.expectedTermsId !== (read()?.id ?? null)
    )
      throw new Error("The sample holding changed.");
    const next = PositionEconomicsTermsSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      positionId: id,
      acceptedAgainstSnapshotId: beaconEconomicsContext.snapshotId,
      commitmentMinorAtAcceptance: beaconEconomicsContext.committedMinor,
      fundedMinorAtAcceptance: beaconEconomicsContext.fundedMinor,
      acceptedAt: new Date().toISOString(),
      decisionSource: "manual",
    });
    saveExample(termsKey, next);
    return next;
  };
  return (
    <section
      className="holding-detail-workspace"
      aria-label="Selected position"
    >
      <SectionHeader
        title="Harbor Health Systems"
        description="Beacon Demo SPV · Demo Family LLC"
      />
      <Collapsible className="holding-detail-section">
        <CollapsibleTrigger layout="inline" className="holding-section-toggle">
          <span>
            <strong>Fees &amp; carry</strong>
            <small>Investment amounts and reviewed terms</small>
          </span>
          <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <PositionEconomicsEditor
            holding={holding}
            acceptTerms={accept}
            onAccepted={() => {
              setTerms(read());
              return Promise.resolve();
            }}
          />
        </CollapsibleContent>
      </Collapsible>
      <MaintenanceControls>
        <p className="catalogue-note">
          Reported terms come from the synthetic Sydecar template. Accepted
          terms remain with this position in this tab.
        </p>
      </MaintenanceControls>
    </section>
  );
}

export function HoldingCorrectionsWalkthrough({ terms }: { terms: boolean }) {
  return terms ? <FeeTermsExample /> : <InvestmentExample />;
}
