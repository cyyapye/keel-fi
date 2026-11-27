import {
  readExample,
  saveExample,
  exampleReadback,
} from "./holding-maintenance-fixture";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  Button,
  DataItem,
  DataList,
  RecordItem,
  SectionHeader,
  TextLink,
} from "@keel/ui";
import {
  ManualHoldingInputSchema,
  ManualHoldingReceiptSchema,
  type ManualHoldingInput,
  type ManualHoldingOptions,
} from "../../packages/domain/src/manual-holdings";
import { ManualHoldingEditor } from "../../apps/web/src/ManualHoldingEditor";
import { formatDate, formatMoney } from "../../apps/web/src/format";
import {
  MaintenanceControls,
  ExampleSelect,
} from "./holding-maintenance-controls";

const choices = [
  "Save normally",
  "Saved, response lost",
  "Save did not reach Keel",
] as const;
type Mode = (typeof choices)[number];
const savedSchema = z.array(
  z.object({
    input: ManualHoldingInputSchema,
    receipt: ManualHoldingReceiptSchema,
  }),
);
const key = "keel-ui:holding-maintenance:manual:v1";
const base = "#journeys/maintenance-manual";
const detail = (id: string) => base + "/position/" + encodeURIComponent(id);
const kindNames = {
  direct: "Direct",
  spv_interest: "SPV",
  fund_interest: "Fund",
};

function openExample(mode: Mode) {
  const options: ManualHoldingOptions = {
    householdScope: "catalogue-maintenance-" + choices.indexOf(mode),
    containers: [{ id: "sample-owner", label: "Demo Family LLC", version: 1 }],
    legalEntities: [],
    companies: [
      { id: "sample-company", name: "Juniper Works", revision: "sample-v1" },
    ],
  };
  const records = readExample(key, savedSchema, () => []);
  const failureKey = key + ":failed:" + choices.indexOf(mode);
  async function request(path: string, init: RequestInit) {
    await exampleReadback();
    init.signal?.throwIfAborted();
    if (path === "/api/manual-holdings/options") return Response.json(options);
    if (path.startsWith("/api/manual-holdings/submissions/")) {
      const id = path.slice("/api/manual-holdings/submissions/".length);
      return Response.json({
        receipt:
          records.find((row) => row.input.submissionId === id)?.receipt ?? null,
      });
    }
    if (path !== "/api/manual-holdings" || init.method !== "POST")
      throw new Error("Unknown sample holding action.");
    const input = ManualHoldingInputSchema.parse(
      await new Response(init.body).json(),
    );
    const existing = records.find(
      (row) => row.input.submissionId === input.submissionId,
    );
    if (existing) return Response.json(existing.receipt);
    const loseResponse =
      mode !== "Save normally" &&
      readExample(failureKey, z.string(), () => "") !== input.submissionId;
    if (loseResponse) saveExample(failureKey, input.submissionId);
    if (loseResponse && mode === "Save did not reach Keel") {
      throw new Error(
        "Keel could not confirm the save. Check for this holding before trying again.",
      );
    }
    const receipt = ManualHoldingReceiptSchema.parse({
      submissionId: input.submissionId,
      positionId: "sample-" + input.submissionId,
      snapshotId: "snapshot-" + input.submissionId,
      identityVersion: 1,
      purchaseReceiptId: "purchase-" + input.submissionId,
    });
    records.push({ input, receipt });
    saveExample(key, records);
    if (loseResponse) {
      throw new Error(
        "Keel could not confirm the save. Check for this holding before trying again.",
      );
    }
    return Response.json(receipt);
  }
  return { records, request };
}

function ownerLabel(input: ManualHoldingInput) {
  return input.owner.mode === "new" ? input.owner.label : "Demo Family LLC";
}

function ManualExample({ mode, route }: { mode: Mode; route: string }) {
  const [sample] = useState(() => openExample(mode));
  const add = useRef<HTMLButtonElement>(null);
  const selectedHeading = useRef<HTMLHeadingElement>(null);
  const action = route.slice(base.length);
  const selected = sample.records.find(
    (row) => detail(row.receipt.positionId) === route,
  );
  const previous = useRef(action);
  useEffect(() => {
    if (selected) selectedHeading.current?.focus();
    else if (!action && previous.current) add.current?.focus();
    previous.current = action;
  }, [action, selected]);
  if (action === "/new")
    return (
      <ManualHoldingEditor
        request={sample.request}
        onClose={() => {
          location.hash = base;
        }}
        onSaved={async (receipt) => {
          await exampleReadback();
          location.hash = detail(receipt.positionId);
        }}
      />
    );
  if (selected) {
    const { input } = selected;
    return (
      <section
        className="holding-detail-workspace"
        aria-label="Selected holding"
      >
        <TextLink href={base}>Back to holdings</TextLink>
        <header className="holding-detail-heading">
          <h2 ref={selectedHeading} tabIndex={-1}>
            {input.name}
          </h2>
          <p className="holding-metadata">
            {kindNames[input.kind]} · {ownerLabel(input)}
          </p>
          <p className="holding-metadata">Entered by you</p>
        </header>
        <DataList layout="rows">
          <DataItem
            label="Company"
            value={
              input.company.mode === "unassigned"
                ? "Unassigned"
                : "Juniper Works"
            }
          />
          {input.cashPaidMinor !== null && (
            <DataItem
              label="Cash paid"
              value={formatMoney(input.cashPaidMinor)}
            />
          )}
          {input.valuation.state === "estimated" && (
            <DataItem
              label={
                "Your estimate of remaining value · " +
                {
                  before_carry: "Before carry",
                  after_carry: "After carry",
                  unknown: "Carry unspecified",
                }[input.valuation.carryStatus]
              }
              value={
                formatMoney(input.valuation.amountMinor) +
                " · " +
                formatDate(input.valuation.effectiveDate)
              }
            />
          )}
        </DataList>
      </section>
    );
  }
  return (
    <section aria-label="Holdings">
      <SectionHeader
        title="Holdings"
        action={
          <Button
            ref={add}
            tone="primary"
            onClick={() => {
              location.hash = base + "/new";
            }}
          >
            Add holding
          </Button>
        }
      />
      {sample.records.map(({ input, receipt }) => (
        <RecordItem
          key={receipt.positionId}
          title={input.name}
          detail={kindNames[input.kind] + " · " + ownerLabel(input)}
          action={
            <TextLink href={detail(receipt.positionId)}>View holding</TextLink>
          }
        />
      ))}
      {action && (
        <p role="status">This sample holding is unavailable in this tab.</p>
      )}
    </section>
  );
}
export function ManualHoldingWalkthrough({ route }: { route: string }) {
  const [mode, setMode] = useState<Mode>(() =>
    readExample(key + ":mode", z.enum(choices), () => choices[0]),
  );
  return (
    <>
      <ManualExample key={mode} mode={mode} route={route} />
      <MaintenanceControls>
        <ExampleSelect
          label="Save example"
          choices={choices}
          value={mode}
          onChange={(value) => {
            location.hash = base;
            saveExample(key + ":mode", value);
            setMode(value);
          }}
        />
        <p className="catalogue-note">
          The Add holding form uses synthetic owner and company choices. Saved
          examples stay in this tab. The selected holding shows the recorded
          identity and any amounts entered.
        </p>
      </MaintenanceControls>
    </>
  );
}
