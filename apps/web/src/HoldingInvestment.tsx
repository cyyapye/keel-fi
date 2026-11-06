import { useRef, useState } from "react";
import type { Holding } from "@keel/domain";
import {
  AcceptPurchasesSchema,
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  purchaseCapital,
  purchaseFeeSummary,
  purchaseShares,
  type PurchaseLot,
} from "@keel/domain/position-purchases";
import {
  investmentFeeAmount,
  type InvestmentFee,
} from "@keel/domain/investment-fees";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
import { HoldingDistributions } from "./HoldingDistributions";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DisclosureIndicator,
  Notice,
  Spinner,
} from "@keel/ui";
import {
  HoldingDate,
  HoldingInput,
  HoldingSelect,
  HoldingShareBasis,
} from "./HoldingFields";
import { decimal, scaled } from "./decimal-input";
import { formatDate, formatMoney, formatSharePrice } from "./format";

const basisOptions = [
  { value: "unknown", label: "Not specified" },
  { value: "cash", label: "Cash paid" },
  { value: "retained", label: "Cash after refund" },
  { value: "net_capital", label: "Net capital" },
  { value: "custom", label: "Specified amount" },
];
const carryBasisOptions = [
  { value: "unknown", label: "Not specified" },
  { value: "gross_cash", label: "Cash after refunds" },
  { value: "net_capital", label: "Net capital" },
];
const blankFee = (kind: InvestmentFee["kind"]): InvestmentFee => ({
  id: crypto.randomUUID(),
  kind,
  coveredLotIds: [],
  paymentStatus: "paid",
  treatment: "upfront",
  dueDate: null,
  label:
    kind === "management"
      ? "Management fee"
      : kind === "one_time"
        ? "One-time fee"
        : "Upfront fees",
  method: "paid",
  paidMinor: null,
  ratePpm: null,
  basis: "unknown",
  basisMinor: null,
  prepaidMonths: null,
});
function feesFor(lot: PurchaseLot): InvestmentFee[] {
  if (lot.fees) return lot.fees;
  const capital = purchaseCapital(lot);
  const fee = blankFee(
    lot.feeLabel?.toLowerCase().includes("management")
      ? "management"
      : "one_time",
  );
  fee.id = `${lot.id}-upfront`;
  fee.label = lot.feeLabel ?? "Upfront fees";
  fee.paidMinor = capital.upfrontDeductionsMinor;
  fee.ratePpm = lot.feePpm;
  fee.basis =
    lot.feeBasis === "gross_cash"
      ? "retained"
      : lot.feeBasis === "net_capital"
        ? "net_capital"
        : "unknown";
  if (fee.paidMinor === null && fee.ratePpm !== null) fee.method = "percentage";
  return fee.paidMinor !== null || fee.ratePpm !== null ? [fee] : [];
}
function feeDetail(fee: InvestmentFee) {
  const basis = basisOptions.find((o) => o.value === fee.basis)?.label;
  return [
    fee.ratePpm === null
      ? null
      : `${decimal(fee.ratePpm, 4)}%${fee.kind === "management" ? " / year" : ""}`,
    fee.ratePpm !== null && fee.basis !== "unknown" ? basis : null,
    fee.kind === "management" && fee.prepaidMonths !== null
      ? fee.prepaidMonths % 12 === 0
        ? `${fee.prepaidMonths / 12} years prepaid`
        : `${fee.prepaidMonths} months prepaid`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
type FeeDraft = {
  original: InvestmentFee;
  method: string;
  paid: string;
  rate: string;
  basis: string;
  basisAmount: string;
  years: string;
  durationUnit: "years" | "months";
  paymentStatus: string;
  dueDate: string;
};
type LotDraft = {
  original: PurchaseLot;
  cash: string;
  refund: string;
  refundStatus: string;
  refundDate: string;
  refundInclusion: string;
  price: string;
  shares: string;
  shareDate: string;
  quantityStatus: string;
  quantityDerivation: string;
  quantityEvidence: string;
  shareBasis: string;
  shareClass: string;
  date: string;
  source: string;
  fees: FeeDraft[];
  feesComplete: boolean;
};
const draftFee = (f: InvestmentFee): FeeDraft => ({
  original: f,
  method: f.method,
  paid: decimal(f.paidMinor, 2),
  rate: decimal(f.ratePpm, 4),
  basis: f.basis,
  basisAmount: decimal(f.basisMinor, 2),
  years:
    f.prepaidMonths === null
      ? ""
      : String(
          f.prepaidMonths % 12 === 0 ? f.prepaidMonths / 12 : f.prepaidMonths,
        ),
  durationUnit:
    f.prepaidMonths !== null && f.prepaidMonths % 12 !== 0 ? "months" : "years",
  paymentStatus: f.paymentStatus,
  dueDate: f.dueDate ?? "",
});
const draftLot = (lot: PurchaseLot): LotDraft => {
  const fees = feesFor(lot).map((f) => ({
    ...f,
    basisMinor:
      f.basis === "net_capital"
        ? (f.basisMinor ?? lot.netCapitalMinor)
        : f.basisMinor,
  }));
  for (const kind of ["one_time", "management"] as const)
    if (!fees.some((f) => f.kind === kind)) fees.push(blankFee(kind));
  return {
    original: lot,
    cash: decimal(lot.grossCashMinor, 2),
    refund: decimal(lot.capitalReturn?.amountMinor, 2),
    refundStatus: lot.capitalReturn?.status ?? "received",
    refundDate: lot.capitalReturn?.effectiveDate ?? "",
    refundInclusion: lot.capitalReturn?.reportedDistributions ?? "unknown",
    price: decimal(lot.priceMicros, 6),
    shares: decimal(lot.remainingSharesMicros, 6),
    shareDate: lot.sharesAsOf ?? "",
    quantityStatus: lot.quantityDetails?.status ?? "",
    quantityDerivation: lot.quantityDetails?.derivation ?? "",
    quantityEvidence: lot.quantityDetails?.evidence ?? "",
    shareBasis: lot.quantityDetails
      ? String(lot.quantityDetails.shareBasis.unitsPerOriginal)
      : "",
    shareClass: lot.shareClass ?? "",
    date: lot.purchasedOn ?? "",
    source: lot.sourceLabel ?? "",
    fees: fees.map(draftFee),
    feesComplete: lot.feesComplete ?? lot.upfrontDeductionsMinor != null,
  };
};
const feeTouched = (f: FeeDraft) =>
  Boolean(
    f.paid ||
    f.years ||
    (f.method === "percentage" && f.rate) ||
    f.original.ratePpm !== null,
  );
function parsedFee(f: FeeDraft) {
  const years = scaled(f.years, 2);
  const months =
    f.durationUnit === "months"
      ? scaled(f.years, 0)
      : years === null
        ? null
        : !Number.isSafeInteger(years) || (BigInt(years) * 12n) % 100n !== 0n
          ? NaN
          : Number((BigInt(years) * 12n) / 100n);
  return {
    ...f.original,
    method: f.method,
    paidMinor: scaled(f.paid, 2),
    ratePpm: scaled(f.rate, 4),
    basis: f.basis,
    basisMinor:
      scaled(f.basisAmount, 2) ??
      (f.basis === "net_capital" ? f.original.basisMinor : null),
    prepaidMonths: months,
    paymentStatus: f.paymentStatus,
    treatment:
      f.original.paymentStatus === "unpaid" || f.paymentStatus === "unpaid"
        ? "separate"
        : f.original.treatment,
    dueDate: f.dueDate || null,
  };
}
function parsedLot(d: LotDraft) {
  const fees = d.fees.filter(feeTouched).map(parsedFee);
  const gross = scaled(d.cash, 2);
  const refund = scaled(d.refund, 2);
  const unchangedCapital =
    gross === d.original.grossCashMinor &&
    refund === (d.original.capitalReturn?.amountMinor ?? null) &&
    d.refundStatus === (d.original.capitalReturn?.status ?? "received") &&
    JSON.stringify(fees) === JSON.stringify(feesFor(d.original));
  return {
    ...d.original,
    mark: null,
    grossCashMinor: gross,
    netCapitalMinor: unchangedCapital ? d.original.netCapitalMinor : null,
    upfrontDeductionsMinor: unchangedCapital
      ? d.original.upfrontDeductionsMinor
      : null,
    feePpm: null,
    feeBasis: null,
    feeLabel: null,
    fees,
    feesComplete: d.feesComplete,
    capitalReturn: d.refund.trim()
      ? {
          amountMinor: refund,
          status: d.refundStatus,
          effectiveDate: d.refundDate || null,
          reportedDistributions:
            d.refundStatus === "received" ? d.refundInclusion : "unknown",
        }
      : undefined,
    priceMicros: scaled(d.price, 6),
    remainingSharesMicros: scaled(d.shares, 6),
    quantityDetails:
      d.quantityStatus ||
      d.shareBasis.trim() ||
      d.quantityDerivation ||
      d.quantityEvidence
        ? {
            status: d.quantityStatus,
            derivation: d.quantityDerivation,
            evidence: d.quantityEvidence || null,
            shareBasis: {
              key:
                d.original.quantityDetails?.shareBasis.key ?? "issuer-original",
              unitsPerOriginal: scaled(d.shareBasis, 0),
            },
          }
        : undefined,
    sharesAsOf: d.shareDate || null,
    shareClass: d.shareClass || null,
    purchasedOn: d.date || null,
    sourceLabel: d.source || null,
  };
}
function initialLot(holding: Holding): PurchaseLot {
  return PurchaseLotSchema.parse({
    id: crypto.randomUUID(),
    purchasedOn: holding.purchaseContext?.openedOn ?? null,
    shareClass: null,
    priceMicros: null,
    referencePriceMicros: null,
    grossCashMinor:
      holding.positionEconomicsContext?.fundedMinor ??
      holding.investedMinor ??
      null,
    netCapitalMinor: null,
    feePpm: null,
    feeBasis: null,
    feeLabel: null,
    remainingSharesMicros: null,
    sharesAsOf: null,
    sourceLabel: holding.sourceLabel,
    sourceUrl: null,
    mark: null,
  });
}

export function HoldingInvestment({
  holding,
  disabled,
  onAccepted,
  onEditingChange,
  onReadbackPendingChange,
}: {
  holding: Holding;
  disabled: boolean;
  onAccepted: () => Promise<void>;
  onEditingChange: (editing: boolean) => void;
  onReadbackPendingChange: (pending: boolean) => void;
}) {
  const context = holding.purchaseContext!;
  const receipt = context.receipt;
  const staleInvestment =
    receipt &&
    !receipt.details.valuation?.records.some(
      (r) =>
        r.id === receipt.details.valuation?.selected?.recordId &&
        r.followSource,
    ) &&
    (receipt.details.investmentSnapshotId ?? receipt.snapshotId) !==
      context.snapshotId;
  const terms = receipt?.details.investmentTerms ?? unknownInvestmentTerms();
  const [draft, setDraft] = useState<LotDraft[] | null>(null);
  const [distributionsEditing, setDistributionsEditing] = useState(false);
  const [carry, setCarry] = useState("");
  const [carryBasis, setCarryBasis] = useState("unknown");
  const [coverage, setCoverage] = useState(false);
  const [cashCoverage, setCashCoverage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState("");
  const addAcquisition = useRef<HTMLButtonElement>(null);
  const start = () => {
    const lots = (
      receipt?.details.lots.length
        ? receipt.details.lots
        : [initialLot(holding)]
    ).map(draftLot);
    if (terms.annualManagementFeePpm !== null) {
      for (const lot of lots) {
        const management = lot.fees.find(
          (f) => f.original.kind === "management",
        );
        if (management && !management.rate)
          management.rate = decimal(terms.annualManagementFeePpm, 4);
      }
    }
    setDraft(lots);
    setCarry(decimal(terms.carryPpm, 4));
    setCarryBasis(terms.carryBasis);
    setCoverage(receipt?.details.coversPosition ?? true);
    setCashCoverage(receipt?.details.cashCoversPosition ?? true);
    setInitial(
      JSON.stringify({
        lots,
        carry: decimal(terms.carryPpm, 4),
        carryBasis: terms.carryBasis,
        coverage: receipt?.details.coversPosition ?? true,
        cashCoverage: receipt?.details.cashCoversPosition ?? true,
      }),
    );
    setError(null);
    onEditingChange(true);
  };
  const close = () => {
    setDraft(null);
    setError(null);
    onEditingChange(false);
  };
  const update = (
    i: number,
    key: Exclude<keyof LotDraft, "original" | "fees">,
    value: string | boolean,
  ) =>
    setDraft((old) =>
      old!.map((d, j) => (j === i ? { ...d, [key]: value } : d)),
    );
  const updateFee = (
    i: number,
    j: number,
    key: Exclude<keyof FeeDraft, "original">,
    value: string,
  ) =>
    setDraft((old) =>
      old!.map((d, k) =>
        k === i
          ? {
              ...d,
              fees: d.fees.map((f, l) =>
                l === j ? { ...f, [key]: value } : f,
              ),
            }
          : d,
      ),
    );
  const parsed = AcceptPurchasesSchema.safeParse({
    expectedSnapshotId: context.snapshotId,
    expectedReceiptId: receipt?.id ?? null,
    expectedTermsId:
      holding.positionEconomicsContext?.acceptedTerms?.id ?? null,
    details: {
      ...receipt?.details,
      lots: draft?.map(parsedLot) ?? [],
      coversPosition: coverage,
      cashCoversPosition: cashCoverage,
      investmentTerms: { ...terms, carryPpm: scaled(carry, 4), carryBasis },
    },
  });
  const validationError = parsed.success
    ? null
    : parsed.error.issues.find(({ path }) => path.at(-1) !== "unitsPerOriginal")
        ?.message;
  const feeError = parsed.success
    ? parsed.data.details.lots.find(
        (l) => l.feesComplete && purchaseFeeSummary(l) === null,
      )
    : null;
  const changed =
    draft !== null &&
    JSON.stringify({
      lots: draft,
      carry,
      carryBasis,
      coverage,
      cashCoverage,
    }) !== initial;
  const ready =
    parsed.success &&
    !feeError &&
    (changed || Boolean(staleInvestment)) &&
    draft !== null &&
    draft.every((d) => d.cash.trim());
  const save = async () => {
    if (!ready || busy || !parsed.success) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/investment-positions/${encodeURIComponent(holding.id)}/purchases`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Investment could not be saved.",
        );
      PurchaseReceiptSchema.parse(body);
      await onAccepted();
      close();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Investment could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="holding-investment" aria-label="Investment">
      <div className="holding-section-heading">
        <h3>Investment</h3>
        {!draft && (
          <Button
            tone="quiet"
            aria-label="Edit investment"
            disabled={disabled || distributionsEditing}
            onClick={start}
          >
            Edit
          </Button>
        )}
      </div>
      {staleInvestment && (
        <p>
          Source updated. Review Investment to use these inputs in calculations.
        </p>
      )}
      {draft ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="holding-form-fieldset">
            {draft.map((d, i) => (
              <div className="holding-acquisition" key={d.original.id}>
                {draft.length > 1 && (
                  <div className="holding-section-heading">
                    <h4>Acquisition {i + 1}</h4>
                    {!receipt?.details.lots.some(
                      (lot) => lot.id === d.original.id,
                    ) &&
                      i > 0 && (
                        <Button
                          tone="quiet"
                          aria-label={`Remove acquisition ${i + 1}`}
                          onClick={() => {
                            setDraft((old) =>
                              old!.filter(
                                (lot) => lot.original.id !== d.original.id,
                              ),
                            );
                            requestAnimationFrame(() =>
                              addAcquisition.current?.focus(),
                            );
                          }}
                        >
                          Remove
                        </Button>
                      )}
                  </div>
                )}
                <div className="holding-fields">
                  <HoldingInput
                    label="Cash paid · $"
                    value={d.cash}
                    onChange={(v) => update(i, "cash", v)}
                    numeric
                  />
                  <HoldingInput
                    label="Capital refund · $"
                    value={d.refund}
                    onChange={(v) => update(i, "refund", v)}
                    numeric
                  />
                  {d.refund && (
                    <>
                      <HoldingSelect
                        label="Refund status"
                        value={d.refundStatus}
                        onChange={(v) => update(i, "refundStatus", v)}
                        options={[
                          { value: "received", label: "Received" },
                          { value: "expected", label: "Expected" },
                        ]}
                      />
                      <HoldingDate
                        label="Refund date"
                        value={d.refundDate}
                        onChange={(v) => update(i, "refundDate", v)}
                      />
                      {d.refundStatus === "received" && (
                        <HoldingSelect
                          label="Included in reported distributions"
                          value={d.refundInclusion}
                          onChange={(v) => update(i, "refundInclusion", v)}
                          options={[
                            { value: "unknown", label: "Unknown" },
                            { value: "included", label: "Included" },
                            { value: "excluded", label: "Excluded" },
                          ]}
                        />
                      )}
                    </>
                  )}
                  <HoldingInput
                    label="Purchase price / share · $"
                    value={d.price}
                    onChange={(v) => update(i, "price", v)}
                    numeric
                  />
                  <HoldingInput
                    label="Shares"
                    value={d.shares}
                    onChange={(v) => update(i, "shares", v)}
                    numeric
                  />
                  <HoldingInput
                    label="Share class"
                    value={d.shareClass}
                    onChange={(v) => update(i, "shareClass", v)}
                  />
                </div>
                {d.fees.map((f, j) => (
                  <div className="holding-fee-editor" key={f.original.id}>
                    <h4>{f.original.label}</h4>
                    <div className="holding-fields">
                      <HoldingSelect
                        label={`${f.original.label} entry`}
                        value={f.method}
                        onChange={(v) => updateFee(i, j, "method", v)}
                        options={[
                          { value: "paid", label: "Paid amount" },
                          {
                            value: "percentage",
                            label:
                              f.original.kind === "management"
                                ? "Annual percentage"
                                : "Percentage",
                          },
                        ]}
                      />
                      {(f.original.paymentStatus === "unpaid" ||
                        f.original.treatment === "separate") && (
                        <HoldingSelect
                          label={`${f.original.label} payment`}
                          value={f.paymentStatus}
                          onChange={(v) => updateFee(i, j, "paymentStatus", v)}
                          options={[
                            { value: "paid", label: "Paid" },
                            { value: "unpaid", label: "Unpaid" },
                          ]}
                        />
                      )}
                      {f.paymentStatus === "unpaid" && (
                        <HoldingDate
                          label={`${f.original.label} due`}
                          value={f.dueDate}
                          onChange={(v) => updateFee(i, j, "dueDate", v)}
                        />
                      )}
                      {f.method === "paid" ? (
                        <HoldingInput
                          label={`${f.original.label} ${f.paymentStatus === "unpaid" ? "due" : "paid"} · $`}
                          value={f.paid}
                          onChange={(v) => updateFee(i, j, "paid", v)}
                          numeric
                        />
                      ) : (
                        <>
                          <HoldingInput
                            label={`${f.original.label} · %${f.original.kind === "management" ? " / year" : ""}`}
                            value={f.rate}
                            onChange={(v) => updateFee(i, j, "rate", v)}
                            numeric
                          />
                          <HoldingSelect
                            label={`${f.original.label} basis`}
                            value={f.basis}
                            onChange={(v) => updateFee(i, j, "basis", v)}
                            options={basisOptions}
                          />
                          {["custom", "net_capital"].includes(f.basis) && (
                            <HoldingInput
                              label={`${f.original.label} basis · $`}
                              value={f.basisAmount}
                              onChange={(v) =>
                                updateFee(i, j, "basisAmount", v)
                              }
                              numeric
                            />
                          )}
                          {f.original.kind === "management" && (
                            <HoldingInput
                              label={`Prepaid ${f.durationUnit}`}
                              value={f.years}
                              onChange={(v) => updateFee(i, j, "years", v)}
                              numeric
                            />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
                <HoldingSelect
                  label="Upfront fees"
                  value={d.feesComplete ? "complete" : "incomplete"}
                  onChange={(v) => update(i, "feesComplete", v === "complete")}
                  options={[
                    { value: "complete", label: "All upfront fees recorded" },
                    { value: "incomplete", label: "Some fees are unknown" },
                  ]}
                />
                <Collapsible>
                  <CollapsibleTrigger layout="inline">
                    Source details
                    <DisclosureIndicator />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="holding-fields">
                      <HoldingDate
                        label="Purchase date"
                        value={d.date}
                        onChange={(v) => update(i, "date", v)}
                      />
                      <HoldingDate
                        label="Shares as of"
                        value={d.shareDate}
                        onChange={(v) => update(i, "shareDate", v)}
                      />
                      <HoldingSelect
                        label="Quantity status"
                        value={d.quantityStatus}
                        onChange={(v) => update(i, "quantityStatus", v)}
                        options={[
                          { value: "", label: "Not documented" },
                          { value: "estimated", label: "Estimated shares" },
                          { value: "confirmed", label: "Confirmed allocation" },
                        ]}
                      />
                      <HoldingShareBasis
                        label="Quantity share basis"
                        value={d.shareBasis}
                        required={Boolean(
                          d.quantityStatus ||
                          d.quantityDerivation ||
                          d.quantityEvidence,
                        )}
                        onChange={(v) => update(i, "shareBasis", v)}
                      />
                      <HoldingInput
                        label="Quantity derivation"
                        value={d.quantityDerivation}
                        onChange={(v) => update(i, "quantityDerivation", v)}
                      />
                      <HoldingInput
                        label="Quantity evidence"
                        value={d.quantityEvidence}
                        onChange={(v) => update(i, "quantityEvidence", v)}
                      />
                      <HoldingInput
                        label="Purchase source"
                        value={d.source}
                        onChange={(v) => update(i, "source", v)}
                      />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            ))}
            <ActionGroup align="end" className="holding-acquisition-actions">
              <Button
                ref={addAcquisition}
                tone="quiet"
                disabled={draft.length >= 20}
                onClick={() =>
                  setDraft((old) => [
                    ...old!,
                    draftLot({ ...initialLot(holding), grossCashMinor: null }),
                  ])
                }
              >
                Add acquisition
              </Button>
            </ActionGroup>
            <div className="holding-fields">
              <HoldingInput
                label="Carry · %"
                value={carry}
                onChange={setCarry}
                numeric
              />
              <HoldingSelect
                label="Carry gains above"
                value={carryBasis}
                onChange={setCarryBasis}
                options={carryBasisOptions}
              />
              {(draft.length > 1 ||
                receipt?.details.cashCoversPosition === false) &&
                !receipt?.details.cashCoversPosition && (
                  <HoldingSelect
                    label="Contributions cover"
                    value={cashCoverage ? "all" : "partial"}
                    onChange={(v) => setCashCoverage(v === "all")}
                    options={[
                      { value: "partial", label: "Part of this position" },
                      { value: "all", label: "This whole position" },
                    ]}
                  />
                )}
              {(draft.length > 1 ||
                receipt?.details.coversPosition === false) &&
                !receipt?.details.coversPosition &&
                draft.some((d) => d.shares) && (
                  <HoldingSelect
                    label="Shares cover"
                    value={coverage ? "all" : "partial"}
                    onChange={(v) => setCoverage(v === "all")}
                    options={[
                      { value: "partial", label: "Part of this position" },
                      { value: "all", label: "This whole position" },
                    ]}
                  />
                )}
            </div>
            {changed && validationError && (
              <Notice tone="error">{validationError}</Notice>
            )}
            {feeError && (
              <Notice>Complete the fee basis and prepaid duration.</Notice>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <ActionGroup>
              <Button type="submit" tone="primary" disabled={!ready || busy}>
                {busy && <Spinner />}
                {busy ? "Saving…" : "Save"}
              </Button>
              <Button tone="quiet" disabled={busy} onClick={close}>
                Cancel
              </Button>
            </ActionGroup>
          </fieldset>
        </form>
      ) : (
        <>
          {receipt?.details.lots.map((lot, i) => {
            const content = <InvestmentFacts lot={lot} />;
            return receipt.details.lots.length > 1 ? (
              <Collapsible key={lot.id}>
                <CollapsibleTrigger layout="inline">
                  Acquisition {i + 1}
                  {lot.purchasedOn ? ` · ${formatDate(lot.purchasedOn)}` : ""}
                  <DisclosureIndicator />
                </CollapsibleTrigger>
                <CollapsibleContent>{content}</CollapsibleContent>
              </Collapsible>
            ) : (
              <div key={lot.id}>
                {lot.purchasedOn && (
                  <p className="holding-metadata">
                    {[
                      formatDate(lot.purchasedOn),
                      lot.shareClass,
                      lot.transactionType === "secondary"
                        ? "Secondary"
                        : lot.transactionType === "primary"
                          ? "Primary"
                          : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
                {content}
              </div>
            );
          })}
          {(terms.carryPpm !== null ||
            terms.annualManagementFeePpm !== null) && (
            <DataList layout="rows">
              {terms.carryPpm !== null && (
                <DataItem
                  label="Carry"
                  value={
                    <>
                      {decimal(terms.carryPpm, 4)}%
                      {terms.carryBasis !== "unknown" && (
                        <small>
                          On gains above{" "}
                          {terms.carryBasis === "gross_cash"
                            ? "cash after refunds"
                            : "net capital"}
                        </small>
                      )}
                    </>
                  }
                />
              )}{" "}
              {terms.annualManagementFeePpm !== null &&
                !receipt?.details.lots.some((l) =>
                  l.fees?.some((f) => f.kind === "management"),
                ) && (
                  <DataItem
                    label="Management rate"
                    value={`${decimal(terms.annualManagementFeePpm, 4)}% / year`}
                  />
                )}
            </DataList>
          )}
        </>
      )}
      <HoldingDistributions
        holding={holding}
        disabled={disabled || draft !== null}
        onAccepted={onAccepted}
        onReadbackPendingChange={onReadbackPendingChange}
        onEditingChange={(editing) => {
          setDistributionsEditing(editing);
          onEditingChange(editing);
        }}
      />
    </section>
  );
}
function InvestmentFacts({ lot }: { lot: PurchaseLot }) {
  const shares = purchaseShares(lot);
  const fees = feesFor(lot).filter((f) => f.paymentStatus !== "unpaid");
  return (
    <DataList layout="rows">
      {lot.grossCashMinor !== null && (
        <DataItem label="Cash paid" value={formatMoney(lot.grossCashMinor)} />
      )}
      {lot.capitalReturn && (
        <DataItem
          label={
            lot.capitalReturn.status === "received"
              ? "Capital refund"
              : "Expected refund"
          }
          value={
            <>
              {formatMoney(lot.capitalReturn.amountMinor)}
              {lot.capitalReturn.effectiveDate && (
                <small>{formatDate(lot.capitalReturn.effectiveDate)}</small>
              )}
            </>
          }
        />
      )}
      {fees.map((f) => {
        const amount = investmentFeeAmount(f, {
          grossCashMinor: lot.grossCashMinor,
          refundMinor:
            lot.capitalReturn?.status === "received"
              ? lot.capitalReturn.amountMinor
              : 0,
          netCapitalMinor: lot.netCapitalMinor,
        });
        return amount === 0 ||
          (amount === null && f.ratePpm === null) ? null : (
          <DataItem
            key={f.id}
            label={`${f.method === "percentage" ? "Estimated " : ""}${f.label}${f.kind === "management" && f.prepaidMonths !== null ? " · prepaid" : ""}`}
            value={
              <>
                {amount !== null
                  ? formatMoney(amount)
                  : `${decimal(f.ratePpm, 4)}%`}
                {amount !== null && feeDetail(f) && (
                  <small>
                    {feeDetail(f)}
                    {f.coveredLotIds.length > 1
                      ? " · Covers these acquisitions"
                      : ""}
                  </small>
                )}
              </>
            }
          />
        );
      })}
      {lot.priceMicros !== null && (
        <DataItem
          label="Purchase price"
          value={`${formatSharePrice(lot.priceMicros)}/share`}
        />
      )}
      {shares && (
        <DataItem
          label={
            lot.quantityDetails?.status === "estimated"
              ? "Estimated shares"
              : "Shares"
          }
          value={
            <>
              {decimal(shares.quantityMicros, 6)}
              {lot.sharesAsOf && <small>{formatDate(lot.sharesAsOf)}</small>}
            </>
          }
        />
      )}
    </DataList>
  );
}
