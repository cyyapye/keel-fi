import { formatHoldingsAmount } from "@keel/ui/money";
import { useEffect, useRef, useState } from "react";
import {
  ActionGroup,
  Button,
  ButtonLink,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  EmptyState,
  Field,
  RecordGroup,
  RecordRow,
  Screen,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextLink,
} from "@keel/ui";
import { formatMoney } from "../../apps/web/src/format";
import { multiInstitutionInvestmentHoldingsView } from "../investment-holdings-fixtures";

const money = formatMoney;
const statements = {
  initial: "Fund value only",
  partial: "40% Cloud disclosed",
  complete: "40% Cloud · 60% Infrastructure",
} as const;
const paidIn = 2_000_000n;
const upfrontFees = 50_000n;
const receivedRefund = 150_000n;
const netInvested = paidIn - upfrontFees - receivedRefund;
const harborEvidence = {
  mark: {
    name: "GP statement",
    label: "GP mark",
    minor: 2_500_000n,
    detail: "The GP reports $25,000 for Horizon SPV’s Harbor position.",
  },
  cost: {
    name: "Reconciled capital statement",
    label: "At cost · Net invested",
    minor: netInvested,
    detail: `Net invested is ${money(netInvested)} after ${money(upfrontFees)} in upfront fees and a ${money(receivedRefund)} refund on ${money(paidIn)} paid in.`,
  },
  zero: {
    name: "GP write-off",
    label: "GP mark",
    minor: 0n,
    detail: "The GP reports a remaining position value of $0.",
  },
} as const;
type Evidence = keyof typeof harborEvidence;
type Row = { title: string; detail: string; minor: bigint };
type Exposure = {
  name: string;
  detail: string;
  minor: bigint | null;
  rows: Row[];
  note?: string;
};

const holdingsHref = "#journeys/holdings-total";
const positionHref = "#journeys/holdings-total-position";
const valuationHref = "#journeys/holdings-total-valuation";

export function HoldingsTotalJourney({
  view,
}: {
  view: "holdings" | "position" | "valuation";
}) {
  const [positions] = useState(() =>
    multiInstitutionInvestmentHoldingsView().exposureView.positions.filter(
      (p) => p.instrumentType !== "cash",
    ),
  );
  const [statement, setStatement] =
    useState<keyof typeof statements>("initial");
  const [harbor, setHarbor] = useState<Evidence | null>(null);
  const [draft, setDraft] = useState<Evidence>("mark");
  const [tab, setTab] = useState("all");
  const [ascending, setAscending] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const editLink = useRef<HTMLAnchorElement>(null);
  const evidencePicker = useRef<HTMLButtonElement>(null);

  const publicRows = positions
    .filter((p) => p.ticker === "NVDA")
    .map((p) => ({
      title: p.containerLabel,
      detail: "Brokerage balance",
      minor: BigInt(p.valueMinor!),
    }));
  const beacon = "Beacon Robotics";
  const beaconRows = positions
    .filter((p) => p.reportedExposureName === beacon)
    .map((p) => ({
      title: p.legalVehicleName,
      detail:
        p.valueSource === "portfolio_watch_estimate"
          ? "Portfolio Watch estimate"
          : "GP mark",
      minor: BigInt(p.valueMinor!),
    }));
  const fund = positions.find((p) => p.ticker === "SYNF")!;
  const fundValue = BigInt(fund.valueMinor!);
  const cloud = statement === "initial" ? 0n : (fundValue * 40n) / 100n;
  const infrastructure = statement === "complete" ? fundValue - cloud : 0n;
  const fundRemainder = fundValue - cloud - infrastructure;
  const sum = (rows: Row[]) => rows.reduce((sum, row) => sum + row.minor, 0n);
  const exposures: Exposure[] = [
    {
      name: "NVDA",
      detail: "3 positions",
      rows: publicRows,
      minor: sum(publicRows),
    },
    {
      name: beacon,
      detail: "2 positions · 1 estimate",
      rows: beaconRows,
      minor: sum(beaconRows),
    },
  ];
  function fundExposure(
    name: string,
    detail: string,
    minor: bigint,
    evidence: string,
  ) {
    if (minor > 0n)
      exposures.push({
        name,
        detail,
        minor,
        rows: [{ title: fund.legalVehicleName, detail: evidence, minor }],
        note: "Fidelity brokerage reports $90K for the whole SYNF position.",
      });
  }
  fundExposure(
    "SYNF",
    fundRemainder === fundValue
      ? "Synthetic Growth Fund"
      : "Remaining fund value",
    fundRemainder,
    statement === "initial" ? "Full fund value" : "60% held at fund level",
  );
  fundExposure(
    "Cloud Basket",
    "Through SYNF · 40%",
    cloud,
    "40% of fund value",
  );
  fundExposure(
    "Infrastructure Basket",
    "Through SYNF · 60%",
    infrastructure,
    "60% of fund value",
  );
  const saved = harbor === null ? null : harborEvidence[harbor];
  exposures.push(
    saved
      ? {
          name: "Harbor Health Systems",
          detail: saved.label,
          minor: saved.minor,
          rows: [
            { title: "Horizon SPV", detail: saved.name, minor: saved.minor },
          ],
          ...(harbor === "cost" && {
            note: `${formatHoldingsAmount(paidIn)} paid in · ${formatHoldingsAmount(upfrontFees)} upfront fees · ${formatHoldingsAmount(receivedRefund)} refund`,
          }),
        }
      : {
          name: "Harbor Health Systems",
          detail: "1 position · Outside total",
          minor: null,
          rows: [],
        },
  );
  exposures.sort((a, b) => {
    if (a.minor === null) return b.minor === null ? 0 : 1;
    if (b.minor === null) return -1;
    return (
      (ascending ? 1 : -1) *
      (a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0)
    );
  });
  const total = positions.reduce<bigint>(
    (sum, position) => sum + BigInt(position.valueMinor ?? 0),
    saved?.minor ?? 0n,
  );
  useEffect(() => {
    if (view === "valuation") evidencePicker.current?.focus();
    if (view === "position") editLink.current?.focus();
  }, [view]);

  const valuationAction = (label: string) => (
    <ButtonLink
      ref={view === "position" ? editLink : undefined}
      href={valuationHref}
      tone="quiet"
      onClick={() => setDraft(harbor ?? "mark")}
    >
      {label}
    </ButtonLink>
  );
  function applyEvidence() {
    setHarbor(draft);
    setExpanded("Harbor Health Systems");
    setTab("all");
    window.location.replace(positionHref);
  }
  const editor = (
    <div className="catalogue-stack">
      <Field
        label="Simulated valuation evidence"
        className="catalogue-valuation-field"
      >
        {(control) => (
          <Select
            value={draft}
            onValueChange={(v: unknown) => {
              if (typeof v === "string" && Object.hasOwn(harborEvidence, v))
                setDraft(v as Evidence);
            }}
          >
            <SelectTrigger {...control} ref={evidencePicker}>
              <SelectValue>{harborEvidence[draft].name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(harborEvidence).map(([id, item]) => (
                <SelectItem key={id} value={id}>
                  {item.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <p>{harborEvidence[draft].detail}</p>
      <ActionGroup wrap>
        <Button tone="primary" onClick={applyEvidence}>
          Use {money(harborEvidence[draft].minor)}
          {draft === "cost" ? " at cost" : " GP mark"}
        </Button>
        <Button
          tone="plain"
          onClick={() => window.location.replace(positionHref)}
        >
          Cancel
        </Button>
      </ActionGroup>
    </div>
  );
  if (view !== "holdings")
    return (
      <Screen
        className="catalogue-stack"
        role="region"
        aria-label="Holdings total journey"
      >
        <TextLink href={holdingsHref}>Back to holdings</TextLink>
        <SectionHeader
          title="Harbor Health Systems"
          description="Horizon SPV · Demo Family LLC"
        />
        <section className="catalogue-stack" aria-label="Valuation">
          <SectionHeader
            headingAs="h3"
            title="Valuation"
            action={
              view === "position" &&
              valuationAction(saved ? "Change valuation" : "Add valuation")
            }
          />
          {view === "valuation"
            ? editor
            : saved && (
                <Stat
                  label={saved.label}
                  value={money(saved.minor)}
                  detail={saved.name}
                />
              )}
        </section>
      </Screen>
    );
  return (
    <Screen
      className="catalogue-stack"
      role="region"
      aria-label="Holdings total journey"
    >
      <TextLink href="#journeys">All journeys</TextLink>
      <p className="catalogue-note">Proposed journey · Synthetic holdings</p>
      <Field
        label="Simulated fund statement"
        className="catalogue-valuation-field"
      >
        {(control) => (
          <Select
            value={statement}
            onValueChange={(v: unknown) => {
              if (typeof v === "string" && Object.hasOwn(statements, v))
                setStatement(v as keyof typeof statements);
            }}
          >
            <SelectTrigger {...control}>
              <SelectValue>{statements[statement]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(statements).map(([id, text]) => (
                <SelectItem key={id} value={id}>
                  {text}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>
      <section aria-label="Holdings reconciliation" className="catalogue-stack">
        <SectionHeader
          title="Exposures"
          trailingStat={
            <Stat
              label={saved ? "Total" : "Known total"}
              value={formatHoldingsAmount(total)}
              detail={`${exposures.length} exposures · ${positions.length} positions`}
            />
          }
        />
        <Tabs
          value={tab}
          onValueChange={(v: unknown) => {
            if (v === "all" || v === "resolution") {
              setTab(v);
            }
          }}
        >
          <TabsList aria-label="Exposure views" variant="line">
            <TabsTrigger value="all">All exposures</TabsTrigger>
            <TabsTrigger value="resolution">
              Needs resolution{saved ? "" : " (1)"}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all">
            <ActionGroup align="end">
              <Button
                tone="plain"
                aria-label={`Sort by value, ${ascending ? "lowest" : "highest"} first`}
                onClick={() => setAscending(!ascending)}
              >
                Value {ascending ? "↑" : "↓"}
              </Button>
            </ActionGroup>
            <RecordGroup
              layout="disclosures"
              aria-label="Company and fund exposures"
            >
              {exposures.map((group) => (
                <Collapsible
                  key={group.name}
                  role="listitem"
                  className="exposure-group"
                  open={expanded === group.name}
                  onOpenChange={(open) => setExpanded(open ? group.name : null)}
                >
                  <CollapsibleTrigger className="exposure-row exposure-group__summary">
                    <span className="exposure-group__identity">
                      <strong>{group.name}</strong>
                      <small>{group.detail}</small>
                    </span>
                    <span
                      className={
                        group.minor === null
                          ? "exposure-group__value exposure-group__value--excluded"
                          : "exposure-group__value"
                      }
                    >
                      {group.minor === null
                        ? "Awaiting valuation"
                        : formatHoldingsAmount(group.minor)}
                    </span>
                    <DisclosureIndicator className="exposure-group__indicator" />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="exposure-group__positions catalogue-stack">
                      {group.note && (
                        <p className="catalogue-note">{group.note}</p>
                      )}
                      <RecordGroup aria-label={`${group.name} positions`}>
                        {group.minor === null && (
                          <RecordRow
                            title="Horizon SPV"
                            detail="No dollar value on file"
                            action={valuationAction("Add valuation")}
                          />
                        )}
                        {group.rows.map((row) => (
                          <RecordRow
                            key={row.title}
                            title={row.title}
                            detail={row.detail}
                            value={formatHoldingsAmount(row.minor)}
                          />
                        ))}
                      </RecordGroup>
                      {saved && group.name === "Harbor Health Systems" && (
                        <ActionGroup>
                          {valuationAction("Change valuation")}
                        </ActionGroup>
                      )}
                      {group.name === beacon && (
                        <TextLink href="#journeys/closing-price">
                          Explore using an official closing price
                        </TextLink>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
            </RecordGroup>
          </TabsContent>
          <TabsContent value="resolution">
            {saved ? (
              <EmptyState compact title="All positions valued" icon={null} />
            ) : (
              <RecordGroup aria-label="Positions needing a valuation">
                <RecordRow
                  title="Harbor Health Systems"
                  detail="Horizon SPV · No dollar value on file"
                  action={valuationAction("Add valuation")}
                />
              </RecordGroup>
            )}
          </TabsContent>
        </Tabs>
      </section>
    </Screen>
  );
}
