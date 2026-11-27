import {
  readExample,
  saveExample,
  exampleReadback,
} from "./holding-maintenance-fixture";
import { useState } from "react";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DisclosureIndicator,
  SectionHeader,
} from "@keel/ui";
import { HoldingSchema } from "../../packages/domain/src/index";
import {
  AcceptPositionLinkSchema,
  PositionLinkReceiptSchema,
  type AcceptPositionLink,
  type PositionLinkReceipt,
} from "../../packages/domain/src/position-links";
import { PositionLinksEditor } from "../../apps/web/src/PositionLinksEditor";
import { formatDate, formatMoney } from "../../apps/web/src/format";
import { investmentHoldingsViewFor } from "../investment-holdings-fixtures";
import { MaintenanceControls } from "./holding-maintenance-controls";

const records = [
  {
    id: "current",
    name: "Demo Orbit VII SPV",
    provider: "Sydecar",
    observedOn: "2026-09-20",
    invested: 600_000,
    value: null,
  },
  {
    id: "source",
    name: "Demo Orbit Aerospace source",
    provider: "Tokenfolio",
    observedOn: "2026-09-17",
    invested: 520_000,
    value: 1_560_000,
  },
  {
    id: "previous",
    name: "Demo Orbit V SPV",
    provider: "Sydecar",
    observedOn: "2026-05-10",
    invested: 600_000,
    value: null,
  },
].map((row) =>
  HoldingSchema.parse({
    id: row.id,
    companyId: "sample-orbit",
    positionName: row.name,
    exposureName: "Demo Orbit Aerospace",
    ownerLabel: "Demo Family LLC",
    positionKind: "spv_interest",
    administratorNavMinor: row.value,
    administratorNavState: row.value === null ? "not_set" : "reported",
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "verified",
    sourceLabel: row.provider,
    effectiveDate: row.observedOn,
    retrievedAt: row.observedOn + "T12:00:00.000Z",
    confidencePpm: null,
    investedMinor: row.invested,
    committedMinor: row.invested,
    realizedValueMinor: 0,
    instrumentType: "SPV interest",
    positionValueContext: {
      snapshotId: "snapshot_" + row.id,
      currency: "USD",
      providerValueState: row.value === null ? "not_reported" : "reported",
      providerValueMinor: row.value,
      acceptedAdjustment: null,
    },
  }),
);
const positions = investmentHoldingsViewFor(records)
  .positionView.connections.flatMap((c) =>
    c.containers.flatMap((container) => container.positions),
  )
  .map((position) => ({ ...position, ownerLabel: "Demo Family LLC" }));
const key = "keel-ui:holding-maintenance:links:v1";

function positionExample() {
  let links: PositionLinkReceipt[] = readExample(
    key,
    PositionLinkReceiptSchema.array(),
    () => [],
  );
  return {
    load: async () => {
      await exampleReadback();
      return { positions, links };
    },
    accept: async (input: AcceptPositionLink) => {
      await exampleReadback();
      const choice = AcceptPositionLinkSchema.parse(input);
      const previous = links.find(
        (link) => link.sourcePositionId === choice.sourcePositionId,
      );
      if ((previous?.id ?? null) !== choice.expectedReviewId)
        throw new Error("The records changed. Reload and review again.");
      const receipt = PositionLinkReceiptSchema.parse({
        ...choice,
        id: crypto.randomUUID(),
        acceptedAt: new Date().toISOString(),
      });
      links = [
        ...links.filter(
          (link) => link.sourcePositionId !== choice.sourcePositionId,
        ),
        receipt,
      ];
      saveExample(key, links);
      return receipt;
    },
    refresh: () => Promise.resolve(),
    download: () =>
      Promise.reject(new Error("This sample has no attached documents.")),
    sourceHref: () => undefined,
    selectedValue: () =>
      links.find(
        (link) =>
          link.state === "linked" &&
          link.targetPositionId === "current" &&
          link.useSourceValue,
      )?.sourcePositionId,
  };
}

export function HoldingLinksWalkthrough() {
  const [actions, setActions] = useState(positionExample);
  const [valueSource, setValueSource] = useState(actions.selectedValue());
  const supplier = positions.find((position) => position.id === valueSource);
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <section
        className="holding-detail-workspace spv-holding"
        aria-label="Selected position"
      >
        <SectionHeader
          title="Demo Orbit Aerospace"
          description="Demo Orbit VII SPV · Demo Family LLC"
        />
        <DataList layout="rows">
          <DataItem
            label="Administrator NAV"
            value={
              supplier?.snapshot.unrealizedValue.minor != null
                ? formatMoney(supplier.snapshot.unrealizedValue.minor) +
                  " · " +
                  supplier.source.label +
                  " · " +
                  formatDate(supplier.snapshot.observedAt)
                : "Not reported"
            }
          />
          <DataItem label="Cash paid" value={formatMoney(600_000)} />
        </DataList>
        <Collapsible
          key={generation}
          className="holding-ownership holding-detail-section"
        >
          <CollapsibleTrigger
            layout="inline"
            className="holding-section-toggle"
          >
            <span>
              <strong>Ownership, sources &amp; history</strong>
              <small>
                Demo Family LLC · Sydecar ·{" "}
                {formatDate(records[0]!.effectiveDate)}
              </small>
            </span>
            <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <PositionLinksEditor
              positionId="current"
              actions={actions}
              onAccepted={() => {
                setValueSource(actions.selectedValue());
                return Promise.resolve();
              }}
            />
          </CollapsibleContent>
        </Collapsible>
      </section>
      <MaintenanceControls>
        <p className="catalogue-note">
          Link the other report of the same investment or identify the earlier
          SPV it replaced. The sample keeps links in this tab. Agreement review
          and document downloads are outside this capture.
        </p>
        <Button
          tone="quiet"
          onClick={() => {
            saveExample(key, []);
            setActions(positionExample());
            setValueSource(undefined);
            setGeneration((n) => n + 1);
          }}
        >
          Reset linked records
        </Button>
      </MaintenanceControls>
    </>
  );
}
