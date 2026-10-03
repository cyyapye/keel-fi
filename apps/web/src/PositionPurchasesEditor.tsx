import {
  termsDraft,
  parsedRate,
  type TermsDraft,
} from "./investment-terms-draft";
import {
  InvestmentCalculationPreview,
  InvestmentTermsFields,
  PurchaseCapitalPreview,
} from "./InvestmentTermsPanel";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Holding } from "@keel/domain";
import {
  AcceptPurchasesSchema,
  type SharePriceEvidenceListSchema,
  PositionValuationEvidenceSchema,
  prefillInvestmentCapital,
  PurchaseReceiptSchema,
  PurchaseLotSchema,
  PurchaseDetailsSchema,
  estimatePurchaseValue,
  estimatePurchaseCapital,
  purchaseCapital,
  purchaseShares,
  purchaseAllInPrice,
  reviewedInvestmentFromReceipt,
  type PurchaseLot,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";
import {
  extractPurchaseNotice,
  PurchaseNoticeInputSchema,
} from "@keel/domain/purchase-notice";
import {
  calculatePositionEconomics,
  calculatePositionPerformance,
} from "@keel/domain/position-economics";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  DisclosureIndicator,
  ActionGroup,
  Button,
  DatePicker,
  DataList,
  DataItem,
  Field,
  Input,
  Notice,
  Textarea,
  TextLink,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatGroup,
  SectionHeader,
} from "@keel/ui";
import { formatCurrency, formatDate, formatMoney } from "./format";

type Draft = Record<string, string>;
function percent(ppm: bigint) {
  const sign = ppm < 0n ? "-" : "";
  const n = ppm < 0n ? -ppm : ppm;
  return `${sign}${n / 10000n}.${((n % 10000n) / 100n).toString().padStart(2, "0")}`;
}
function decimal(value: number | null | undefined, digits: number) {
  if (value == null) return "";
  if (value === 0) return "0";
  const unit = 10n ** BigInt(digits),
    n = BigInt(value);
  return `${n / unit}.${(n % unit).toString().padStart(digits, "0")}`.replace(
    /\.?0+$/u,
    "",
  );
}
function unitPrice(value: number | null | undefined) {
  const raw = decimal(value, 6);
  if (!raw) return "";
  const [whole, fraction = ""] = raw.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}
// Round only the summary display. Drafts and calculations retain exact micros.
function displayedUnitPrice(value: number | null | undefined) {
  if (value == null) return "";
  return formatMoney(Number((BigInt(value) + 5_000n) / 10_000n));
}
function scaled(value: string | undefined, digits: number): number | null {
  if (!value?.trim()) return null;
  if (!new RegExp(`^\\d+(?:\\.\\d{0,${digits}})?$`, "u").test(value.trim()))
    return NaN;
  const [whole = "0", fraction = ""] = value.trim().split(".");
  const n =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0"));
  return n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : NaN;
}
function draftFor(lot: PurchaseLot): Draft {
  return {
    originalSharesUnchanged: String(lot.originalSharesUnchanged),
    id: lot.id,
    transactionType: lot.transactionType ?? "",
    referenceRound: lot.referenceRound ?? "",
    reportedPremiumPpm: decimal(lot.reportedPremiumPpm, 4),
    reportedManagementFeePpm: decimal(lot.reportedManagementFeePpm, 4),
    reportedCarryPpm: decimal(lot.reportedCarryPpm, 4),
    sourceText: lot.sourceText ?? "",
    sourceKind: lot.sourceKind ?? "unknown",
    sourceObservedOn: lot.sourceObservedOn ?? "",
    purchasedOn: lot.purchasedOn ?? "",
    shareClass: lot.shareClass ?? "",
    priceMicros: unitPrice(lot.priceMicros),
    referencePriceMicros: unitPrice(lot.referencePriceMicros),
    grossCashMinor: decimal(purchaseCapital(lot).grossCashMinor, 2),
    netCapitalMinor: decimal(purchaseCapital(lot).netCapitalMinor, 2),
    upfrontDeductionsMinor: decimal(
      purchaseCapital(lot).upfrontDeductionsMinor,
      2,
    ),
    capitalReturnAmount: decimal(lot.capitalReturn?.amountMinor, 2),
    capitalReturnStatus: lot.capitalReturn?.status ?? "expected",
    capitalReturnDate: lot.capitalReturn?.effectiveDate ?? "",
    capitalReturnDistributions:
      lot.capitalReturn?.reportedDistributions ?? "unknown",
    nominalSpvUnitsMicros: decimal(lot.nominalSpvUnitsMicros, 6),
    feePpm: decimal(lot.feePpm, 4),
    feeBasis: lot.feeBasis ?? "",
    feeLabel: lot.feeLabel ?? "",
    remainingSharesMicros: decimal(lot.remainingSharesMicros, 6),
    sharesAsOf: lot.sharesAsOf ?? "",
    sourceLabel: lot.sourceLabel ?? "",
    sourceUrl: lot.sourceUrl ?? "",
    markEvidenceId: lot.mark?.sourceEvidenceId ?? "",
    markComparable: String(lot.mark?.comparableConfirmed ?? false),
    markProxy: String(Boolean(lot.mark?.proxy)),
    proxyReason: lot.mark?.proxy?.reason ?? "",
    markCapturedAt: lot.mark?.proxy?.capturedAt ?? "",
    markPrice: unitPrice(lot.mark?.priceMicros),
    markDate: lot.mark?.effectiveDate ?? "",
    markClass: lot.mark?.shareClass ?? "",
    markSource: lot.mark?.sourceLabel ?? "",
    markUrl: lot.mark?.sourceUrl ?? "",
  };
}
function lotFor(d: Draft) {
  return {
    originalSharesUnchanged: d.originalSharesUnchanged === "true",
    id: d.id,
    transactionType: d.transactionType || null,
    referenceRound: d.referenceRound || null,
    reportedPremiumPpm: scaled(d.reportedPremiumPpm, 4),
    reportedManagementFeePpm: scaled(d.reportedManagementFeePpm, 4),
    reportedCarryPpm: scaled(d.reportedCarryPpm, 4),
    sourceText: d.sourceText || null,
    sourceKind: d.sourceKind ?? "unknown",
    sourceObservedOn: d.sourceObservedOn || null,
    purchasedOn: d.purchasedOn || null,
    shareClass: d.shareClass || null,
    priceMicros: scaled(d.priceMicros, 6),
    referencePriceMicros: scaled(d.referencePriceMicros, 6),
    upfrontDeductionsMinor: scaled(d.upfrontDeductionsMinor, 2),
    ...(d.capitalReturnAmount || d.capitalReturnDate
      ? {
          capitalReturn: {
            amountMinor: scaled(d.capitalReturnAmount, 2),
            status: d.capitalReturnStatus || "expected",
            effectiveDate: d.capitalReturnDate || null,
            reportedDistributions:
              d.capitalReturnStatus === "received"
                ? d.capitalReturnDistributions || "unknown"
                : "unknown",
          },
        }
      : {}),
    nominalSpvUnitsMicros: scaled(d.nominalSpvUnitsMicros, 6),
    grossCashMinor: scaled(d.grossCashMinor, 2),
    netCapitalMinor: scaled(d.netCapitalMinor, 2),
    feePpm: scaled(d.feePpm, 4),
    feeBasis: d.feeBasis || null,
    feeLabel: d.feeLabel || null,
    remainingSharesMicros: scaled(d.remainingSharesMicros, 6),
    sharesAsOf: d.sharesAsOf || null,
    sourceLabel: d.sourceLabel || null,
    sourceUrl: d.sourceUrl || null,
    mark: [d.markPrice, d.markDate, d.markClass, d.markSource, d.markUrl].some(
      Boolean,
    )
      ? {
          ...(d.markEvidenceId
            ? {
                sourceEvidenceId: d.markEvidenceId,
                ...(d.markProxy === "true"
                  ? {
                      proxy: {
                        confirmed: true,
                        reason:
                          d.proxyReason?.trim() ||
                          "Closest available imported share price.",
                        capturedAt: d.markCapturedAt,
                      },
                    }
                  : {
                      comparableConfirmed:
                        d.markComparable === "true" ? true : false,
                    }),
              }
            : {}),
          priceMicros: scaled(d.markPrice, 6),
          effectiveDate: d.markDate || null,
          shareClass: d.markClass || null,
          sourceLabel: d.markSource,
          sourceUrl: d.markUrl || null,
        }
      : null,
  };
}
const feeChoices = [
  { value: "unknown", label: "Not specified" },
  { value: "net_capital", label: "Added to share capital" },
  { value: "gross_cash", label: "Deducted from gross cash" },
];

type PurchaseEditorProps = {
  holding: Pick<
    Holding,
    | "id"
    | "sourceLabel"
    | "purchaseContext"
    | "positionEconomicsContext"
    | "realizedValueMinor"
  > &
    Partial<
      Pick<
        Holding,
        "administratorNavMinor" | "effectiveDate" | "linkedReportedValue"
      >
    >;
  onAccepted: () => Promise<void>;
  mode?: "combined" | "purchase" | "valuation";
  onDirtyChange?: (dirty: boolean) => void;
};
export function PositionPurchasesEditor(props: PurchaseEditorProps) {
  if (props.mode === "valuation") {
    const context = props.holding.purchaseContext;
    if (!context) return null;
    const estimate = estimatePurchaseValue(context.receipt, context.snapshotId);
    return (
      <section className="purchase-details" aria-label="Share-based valuation">
        <p>
          {estimate
            ? `Estimated value before carry: ${formatCurrency(estimate.valueMinor, context.currency)}. Remaining shares × recorded price; excludes remaining expenses.`
            : "Add underlying shares and sourced prices in Investment details."}
        </p>
        <TextLink href={`#investment-details-${props.holding.id}`}>
          Edit investment details
        </TextLink>
      </section>
    );
  }
  return <InvestmentDetailsEditor {...props} />;
}
function InvestmentDetailsEditor({
  holding,
  onAccepted,
  mode = "combined",
  onDirtyChange,
}: PurchaseEditorProps) {
  const context = holding.purchaseContext;
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(
    context?.receipt ?? null,
  );
  const initialTerms = useCallback(() => {
    const saved = receipt?.details.investmentTerms;
    const savedValue = saved?.reportedValueReview;
    const currentValue =
      context?.reportedValueMinor !== undefined
        ? context.reportedValueMinor
        : holding.administratorNavMinor;
    const sameValue =
      receipt?.snapshotId === context?.snapshotId &&
      savedValue?.sourceSnapshotId ===
        (context?.reportedValueSnapshotId ??
          holding.linkedReportedValue?.snapshotId ??
          context?.snapshotId) &&
      (currentValue === undefined || savedValue?.valueMinor === currentValue);
    return termsDraft(
      saved
        ? {
            ...saved,
            reportedValueReview: sameValue ? (savedValue ?? null) : null,
          }
        : {
            ...unknownInvestmentTerms(),
            ...(holding.positionEconomicsContext?.acceptedTerms
              ?.acceptedAgainstSnapshotId === context?.snapshotId
              ? {
                  carryPpm:
                    holding.positionEconomicsContext?.acceptedTerms?.carryPpm ??
                    null,
                  carryBasis: "net_capital" as const,
                  importedAmountBasis:
                    holding.positionEconomicsContext?.acceptedTerms
                      ?.capitalBasis === "net_invested"
                      ? ("net_capital" as const)
                      : ("gross_cash" as const),
                }
              : {}),
          },
    );
  }, [
    receipt,
    context,
    holding.positionEconomicsContext,
    holding.administratorNavMinor,
    holding.linkedReportedValue,
  ]);
  const [termDraft, setTermDraft] = useState<TermsDraft>(initialTerms);
  const [cashCoversPosition, setCashCoversPosition] = useState(
    receipt?.details.cashCoversPosition ?? false,
  );
  const [coversPosition, setCoversPosition] = useState(
    receipt?.details.coversPosition ?? false,
  );
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [priceEvidence, setPriceEvidence] = useState<
    ReturnType<typeof SharePriceEvidenceListSchema.parse>
  >([]);
  const [watchEvidence, setWatchEvidence] = useState<
    ReturnType<typeof PositionValuationEvidenceSchema.parse>["watch"]
  >([]);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [priceEvidenceOpen, setPriceEvidenceOpen] = useState(false);
  useEffect(() => {
    if (!open || !priceEvidenceOpen) return;
    const controller = new AbortController();
    void fetch(
      `/api/investment-positions/${encodeURIComponent(holding.id)}/share-price-evidence`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Price evidence could not be loaded. You can still enter a sourced price below.",
          );
        const evidence = PositionValuationEvidenceSchema.parse(
          await response.json(),
        );
        if (controller.signal.aborted) return;
        setEvidenceError(null);
        setPriceEvidence(evidence.prices);
        setWatchEvidence(evidence.watch);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setEvidenceError(
            "Price evidence could not be loaded. Reopen this section to retry, or enter a sourced price below.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingEvidence(false);
      });
    return () => controller.abort();
  }, [open, priceEvidenceOpen, holding.id]);
  const [removed, setRemoved] = useState<{ draft: Draft; index: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeIndex, setNoticeIndex] = useState<number | null>(null);
  const [noticeText, setNoticeText] = useState("");
  const [noticeWarnings, setNoticeWarnings] = useState<string[]>([]);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) editButton.current?.focus();
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    onDirtyChange?.(
      open &&
        (JSON.stringify(termDraft) !== JSON.stringify(initialTerms()) ||
          cashCoversPosition !==
            (receipt?.details.cashCoversPosition ?? false) ||
          coversPosition !== (receipt?.details.coversPosition ?? false) ||
          JSON.stringify(drafts.map(lotFor)) !==
            JSON.stringify(
              receipt
                ? prefillInvestmentCapital(
                    receipt,
                    holding.positionEconomicsContext,
                  ).map((lot) => lotFor(draftFor(lot)))
                : [],
            )),
    );
  }, [
    open,
    coversPosition,
    drafts,
    receipt,
    onDirtyChange,
    termDraft,
    cashCoversPosition,
    holding.positionEconomicsContext,
    initialTerms,
  ]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  if (!context) return null;
  const blank = (prefill: boolean): Draft => {
    const economics =
      prefill && holding.positionEconomicsContext
        ? calculatePositionEconomics(holding.positionEconomicsContext)
        : null;
    const funded =
      economics !== null &&
      (economics.fundedMinor === economics.committedMinor ||
        (holding.positionEconomicsContext?.acceptedTerms?.capitalBasis ===
          "net_invested" &&
          economics.fundedMinor === economics.positionCostBasisMinor));
    return {
      id: crypto.randomUUID(),
      purchasedOn: prefill ? (context.openedOn ?? "") : "",
      sourceLabel: prefill ? holding.sourceLabel : "",
      grossCashMinor: decimal(funded ? economics?.committedMinor : null, 2),
      netCapitalMinor: decimal(
        funded ? economics?.positionCostBasisMinor : null,
        2,
      ),
    };
  };
  const reportedValueMinor =
    context.reportedValueMinor !== undefined
      ? context.reportedValueMinor
      : holding.administratorNavMinor !== undefined
        ? holding.administratorNavMinor
        : receipt?.snapshotId === context.snapshotId
          ? (receipt.details.investmentTerms?.reportedValueReview?.valueMinor ??
            null)
          : null;
  const reportedSource =
    context.reportedSourceLabel ??
    holding.linkedReportedValue?.sourceLabel ??
    holding.sourceLabel;
  const investmentTerms = {
    importedAmountBasis: termDraft.importedAmountBasis,
    annualManagementFeePpm: parsedRate(termDraft.annualManagementFeePpm),
    annualManagementBasis: termDraft.annualManagementBasis,
    carryPpm: parsedRate(termDraft.carryPpm),
    carryBasis: termDraft.carryBasis,
    reportedValueReview:
      reportedValueMinor === null
        ? null
        : {
            sourceSnapshotId:
              context.reportedValueSnapshotId ??
              holding.linkedReportedValue?.snapshotId ??
              context.snapshotId,
            valueMinor: reportedValueMinor,
            sourceLabel: reportedSource,
            effectiveDate: termDraft.valueDate || null,
            carryStatus: termDraft.carryStatus,
          },
    note: termDraft.note ?? "",
  };
  const parsed = AcceptPurchasesSchema.safeParse({
    expectedSnapshotId: context.snapshotId,
    expectedReceiptId: receipt?.id ?? null,
    expectedTermsId:
      holding.positionEconomicsContext?.acceptedTerms?.id ?? null,
    details: {
      investmentTerms,
      cashCoversPosition,
      coversPosition,
      lots: drafts.map(lotFor),
    },
  });
  const changed =
    parsed.success &&
    (receipt?.snapshotId !== context.snapshotId ||
      JSON.stringify(parsed.data.details) !==
        JSON.stringify(
          receipt
            ? PurchaseDetailsSchema.parse({
                ...receipt.details,
                lots: receipt.details.lots.map((lot) => lotFor(draftFor(lot))),
              })
            : { coversPosition: false, lots: [] },
        ));
  const estimate = estimatePurchaseValue(receipt, context.snapshotId);
  const estimatedPerformance =
    estimate && holding.realizedValueMinor != null
      ? calculatePositionPerformance({
          currentValueMinor: estimate.valueMinor,
          currentValueReported: true,
          realizedValueMinor: holding.realizedValueMinor,
          providerCostBasisMinor: null,
          fundedMinor: estimate.grossCashMinor,
          economicsContext: holding.positionEconomicsContext ?? null,
          allowFundedAmountEstimate: true,
        })
      : null;
  const canSave = parsed.success && changed && !busy;
  const money = (n: number) => formatCurrency(n, context.currency);
  const update = (index: number, key: string, value: string) =>
    setDrafts((old) =>
      old.map((d, i) =>
        i === index
          ? {
              ...d,
              [key]: value,
              ...(d.markEvidenceId &&
              (key === "markPrice"
                ? scaled(d[key], 6) !== scaled(value, 6)
                : d[key] !== value) &&
              ["markPrice", "markDate", "markClass", "shareClass"].includes(key)
                ? { markComparable: "false" }
                : {}),
              ...(d.markProxy !== "true" &&
              key === "markPrice" &&
              value &&
              !d.markClass &&
              d.shareClass
                ? { markClass: d.shareClass }
                : {}),
            }
          : d,
      ),
    );
  const field = (i: number, key: string, label: string, numeric = false) => (
    <Field label={label} variant="filled">
      <Input
        aria-label={label}
        inputMode={numeric ? "decimal" : "text"}
        value={drafts[i]?.[key] ?? ""}
        onChange={(event) => update(i, key, event.currentTarget.value)}
        onBlur={() => {
          if (
            !["priceMicros", "referencePriceMicros", "markPrice"].includes(key)
          )
            return;
          const amount = scaled(drafts[i]?.[key], 6);
          if (amount !== null && Number.isSafeInteger(amount))
            update(i, key, unitPrice(amount));
        }}
      />
    </Field>
  );
  const date = (i: number, key: string, label: string) => (
    <Field label={label} variant="filled">
      <DatePicker
        aria-label={label}
        value={drafts[i]?.[key] ?? ""}
        onValueChange={(value) => update(i, key, value)}
      />
    </Field>
  );
  const edit = () => {
    setRemoved([]);
    setTermDraft(initialTerms());
    setCashCoversPosition(receipt?.details.cashCoversPosition ?? false);
    setCoversPosition(receipt?.details.coversPosition ?? false);
    setDrafts(
      receipt?.details.lots.length
        ? prefillInvestmentCapital(
            receipt,
            holding.positionEconomicsContext,
          ).map(draftFor)
        : [blank(true)],
    );
    setError(null);
    setNoticeIndex(null);
    setNoticeWarnings([]);
    setOpen(true);
  };
  const save = async () => {
    if (!parsed.success) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/investment-positions/${encodeURIComponent(holding.id)}/purchases`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok)
        throw new Error(
          typeof body === "object" && body !== null && "error" in body
            ? String(body.error)
            : "Purchase details could not be saved.",
        );
      const accepted = PurchaseReceiptSchema.parse(body);
      setReceipt(accepted);
      setRemoved([]);
      setOpen(false);
      await onAccepted();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Purchase details could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      id={`investment-details-${holding.id}`}
      className="position-economics purchase-details"
      aria-label={
        mode === "valuation" ? "Share-based valuation" : "Investment details"
      }
    >
      {mode === "valuation" && (
        <p>
          Remaining shares × a matching share price or an explicitly chosen
          proxy. Before carry and remaining expenses; does not replace a
          reported mark.
        </p>
      )}
      <div className="position-economics__heading">
        <div>
          {mode !== "valuation" && <h3>{"Investment details"}</h3>}
          {(open || !receipt?.details.lots.length) && mode !== "valuation" && (
            <p>
              {
                "Review cash, economic terms and underlying shares in one place."
              }
            </p>
          )}
        </div>
        {!open && (
          <ActionGroup wrap mobileLayout="stack">
            <Button
              tone={receipt?.details.lots.length ? "quiet" : "secondary"}
              ref={editButton}
              disabled={mode === "valuation" && !receipt?.details.lots.length}
              onClick={() => edit()}
            >
              {mode === "valuation"
                ? estimate
                  ? "Edit share calculation"
                  : "Add share details"
                : receipt?.details.lots.length
                  ? "Edit investment details"
                  : "Add investment details"}
            </Button>
            {mode !== "valuation" && !receipt?.details.lots.length && (
              <Button
                tone="quiet"
                onClick={() => {
                  setDrafts([blank(true)]);
                  setCoversPosition(false);
                  setError(null);
                  setNoticeText("");
                  setNoticeIndex(0);
                  setNoticeWarnings([]);
                  setOpen(true);
                }}
              >
                Paste GP notice
              </Button>
            )}
          </ActionGroup>
        )}
      </div>
      {receipt && receipt.snapshotId !== context.snapshotId && (
        <Notice tone="error">
          The source position changed. Review cash, terms and value evidence
          again before using calculations.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!open && mode !== "valuation" && receipt?.details.investmentTerms && (
        <InvestmentCalculationPreview
          reviewed={reviewedInvestmentFromReceipt(receipt)!}
          reportedValueMinor={reportedValueMinor}
          currentReportedValueSnapshotId={
            context.reportedValueSnapshotId ??
            holding.linkedReportedValue?.snapshotId ??
            context.snapshotId
          }
          currentSnapshotId={context.snapshotId}
        />
      )}
      {!open && receipt && (
        <>
          {mode !== "valuation" &&
            receipt.details.lots.map((lot, i) => {
              if (
                receipt.details.investmentTerms &&
                receipt.details.lots.length === 1 &&
                !lot.priceMicros &&
                !lot.remainingSharesMicros &&
                !lot.sourceText &&
                !lot.capitalReturn &&
                !estimatePurchaseCapital(lot)
              )
                return (
                  <p key={lot.id} className="purchase-summary__metadata">
                    {lot.sourceKind === "executed"
                      ? "Executed evidence"
                      : lot.sourceKind === "deal_snapshot"
                        ? "Historical deal snapshot"
                        : "Purchase source"}
                    : {lot.sourceLabel ?? "unknown"} ·{" "}
                    {lot.purchasedOn
                      ? formatDate(lot.purchasedOn)
                      : "Purchase date unknown"}
                    {lot.sourceObservedOn
                      ? ` · Evidence dated ${formatDate(lot.sourceObservedOn)}`
                      : ""}
                    {lot.nominalSpvUnitsMicros != null
                      ? ` · ${decimal(lot.nominalSpvUnitsMicros, 6)} nominal SPV units`
                      : ""}
                    .
                  </p>
                );
              const shares = purchaseShares(lot);
              const capital = purchaseCapital(lot);
              const allIn = purchaseAllInPrice(lot);
              return (
                <div key={lot.id} className="purchase-summary">
                  {receipt.details.lots.length > 1 && <h4>Purchase {i + 1}</h4>}
                  <PurchaseCapitalPreview lot={lot} />
                  <p className="purchase-summary__metadata">
                    {[
                      lot.shareClass,
                      lot.transactionType
                        ? lot.transactionType === "secondary"
                          ? "Secondary"
                          : "Primary"
                        : null,
                      lot.purchasedOn ? formatDate(lot.purchasedOn) : null,
                      lot.sourceKind === "executed"
                        ? "Executed evidence"
                        : lot.sourceKind === "deal_snapshot"
                          ? "Historical deal snapshot"
                          : null,
                      lot.sourceObservedOn
                        ? `Evidence dated ${formatDate(lot.sourceObservedOn)}`
                        : null,
                      lot.sourceLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="purchase-summary__layout">
                    <div className="purchase-summary__cost">
                      <StatGroup
                        className="purchase-cost"
                        aria-label="Cost per share"
                      >
                        {lot.priceMicros !== null && (
                          <Stat
                            label="Share price"
                            value={displayedUnitPrice(lot.priceMicros)}
                          />
                        )}
                        {allIn !== null && lot.priceMicros !== null && (
                          <>
                            <span
                              className="purchase-cost__operator"
                              aria-hidden="true"
                            >
                              +
                            </span>
                            <Stat
                              label={
                                lot.upfrontDeductionsMinor === undefined &&
                                lot.feePpm !== null &&
                                lot.feeBasis
                                  ? `Upfront fee · ${decimal(lot.feePpm, 4)}% ${lot.feeBasis === "net_capital" ? "on share capital" : "of gross cash"}`
                                  : "Upfront fees / share"
                              }
                              value={displayedUnitPrice(
                                Number(BigInt(allIn) - BigInt(lot.priceMicros)),
                              )}
                            />
                            <span
                              className="purchase-cost__operator"
                              aria-hidden="true"
                            >
                              =
                            </span>
                            <Stat
                              className="purchase-cost__total"
                              label="All-in / share"
                              value={displayedUnitPrice(allIn)}
                            />
                          </>
                        )}
                      </StatGroup>
                      {lot.feePpm !== null && allIn === null && (
                        <p>
                          {lot.feeLabel ?? "One-time fee"}:{" "}
                          {decimal(lot.feePpm, 4)}%
                          {lot.feeBasis === null
                            ? " · basis unknown; excluded from calculations"
                            : ""}
                          .
                        </p>
                      )}
                      {lot.referencePriceMicros !== null && (
                        <p className="purchase-reference-line">
                          {lot.referenceRound ?? "Entry"} reference $
                          {unitPrice(lot.referencePriceMicros)} / share
                          {allIn !== null && (
                            <>
                              {" "}
                              · All-in premium{" "}
                              <strong>
                                {percent(
                                  ((BigInt(allIn) -
                                    BigInt(lot.referencePriceMicros)) *
                                    1_000_000n) /
                                    BigInt(lot.referencePriceMicros),
                                )}
                                %
                              </strong>
                            </>
                          )}
                        </p>
                      )}
                      {(lot.reportedPremiumPpm != null ||
                        (lot.priceMicros !== null &&
                          lot.referencePriceMicros !== null)) && (
                        <Collapsible>
                          <CollapsibleTrigger layout="inline">
                            Calculation details <DisclosureIndicator />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            {lot.priceMicros !== null &&
                              lot.referencePriceMicros !== null && (
                                <p>
                                  Purchase premium:{" "}
                                  {percent(
                                    ((BigInt(lot.priceMicros) -
                                      BigInt(lot.referencePriceMicros)) *
                                      1_000_000n) /
                                      BigInt(lot.referencePriceMicros),
                                  )}
                                  % before upfront fees.
                                </p>
                              )}
                            {allIn !== null &&
                              lot.referencePriceMicros !== null && (
                                <p>
                                  All-in premium is calculated from the share
                                  price plus recorded upfront fees relative to
                                  the reference price.
                                </p>
                              )}
                            {lot.reportedPremiumPpm != null && (
                              <p>
                                Notice-quoted premium:{" "}
                                {percent(BigInt(lot.reportedPremiumPpm))}%. Kept
                                separately from the calculated premium.
                              </p>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </div>
                    <aside
                      className="purchase-summary__context"
                      aria-label="Purchase terms and source"
                    >
                      {lot.feeLabel && (
                        <p>
                          Fee component: {lot.feeLabel}
                          {lot.feePpm !== null
                            ? ` · ${decimal(lot.feePpm, 4)}%`
                            : ""}
                          .
                        </p>
                      )}
                      {lot.referenceRound &&
                        lot.referencePriceMicros === null && (
                          <p>Reference: {lot.referenceRound}.</p>
                        )}
                      {(lot.sourceText ||
                        lot.reportedManagementFeePpm != null ||
                        lot.reportedCarryPpm != null) && (
                        <Collapsible>
                          <CollapsibleTrigger layout="inline">
                            Source notice <DisclosureIndicator />
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            {(lot.reportedManagementFeePpm != null ||
                              lot.reportedCarryPpm != null) && (
                              <>
                                <h4>Reported terms</h4>
                                <DataList className="purchase-reported-terms">
                                  {lot.reportedManagementFeePpm != null && (
                                    <DataItem
                                      label="Reported management fee"
                                      value={`${decimal(lot.reportedManagementFeePpm, 4)}%`}
                                    />
                                  )}
                                  {lot.reportedCarryPpm != null && (
                                    <DataItem
                                      label="Carry"
                                      value={`${decimal(lot.reportedCarryPpm, 4)}%`}
                                    />
                                  )}
                                </DataList>
                              </>
                            )}
                            <p className="purchase-notice-text">
                              {lot.sourceText}
                            </p>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </aside>
                  </div>
                  {(shares ||
                    capital.grossCashMinor !== null ||
                    capital.netCapitalMinor !== null) && (
                    <DataList className="purchase-summary__terms purchase-summary__capital">
                      {lot.nominalSpvUnitsMicros != null && (
                        <DataItem
                          label="Nominal SPV units"
                          value={decimal(lot.nominalSpvUnitsMicros, 6)}
                        />
                      )}
                      {shares && (
                        <DataItem
                          label={
                            <>
                              {shares.derived
                                ? "Calculated original shares"
                                : "Remaining underlying shares"}
                            </>
                          }
                          value={decimal(shares.quantityMicros, 6)}
                        />
                      )}
                      {capital.grossCashMinor !== null && (
                        <DataItem
                          label="Cash paid"
                          value={money(capital.grossCashMinor)}
                        />
                      )}
                      {capital.netCapitalMinor !== null && (
                        <DataItem
                          label="Net capital invested"
                          value={money(capital.netCapitalMinor)}
                        />
                      )}
                    </DataList>
                  )}
                  {mode !== "purchase" && lot.mark && (
                    <DataList className="purchase-summary__terms">
                      <DataItem
                        label="Valuation price"
                        value={
                          <>
                            ${unitPrice(lot.mark.priceMicros)} / share
                            <small>
                              {lot.mark.shareClass} ·{" "}
                              {lot.mark.effectiveDate
                                ? formatDate(lot.mark.effectiveDate)
                                : "Mark date unknown"}{" "}
                              · {lot.mark.sourceLabel}
                            </small>
                          </>
                        }
                      />
                    </DataList>
                  )}
                </div>
              );
            })}
          {mode === "valuation" &&
            receipt.details.lots
              .filter((lot) => lot.mark)
              .map((lot) => (
                <p key={lot.id} className="purchase-summary__metadata">
                  {lot.mark?.shareClass} · ${unitPrice(lot.mark?.priceMicros)} /
                  share · {lot.mark?.sourceLabel} ·{" "}
                  {lot.mark?.effectiveDate
                    ? formatDate(lot.mark.effectiveDate)
                    : "Mark date unknown"}
                </p>
              ))}
          {mode !== "purchase" &&
            (estimate ? (
              <div className="purchase-valuation-result">
                <div>
                  <StatGroup className="holding-performance__values">
                    <Stat
                      label={
                        estimate.proxy
                          ? "Estimated value · proxy"
                          : "Estimated position value · before carry"
                      }
                      value={money(estimate.valueMinor)}
                      detail={`${estimate.effectiveDate ? `As of ${formatDate(estimate.effectiveDate)}` : "Mark date unknown"}${estimate.derivedShares ? " · uses calculated original shares" : ""}`}
                    />
                  </StatGroup>
                  <p>
                    {estimate.lots
                      .map(
                        (row) =>
                          `${decimal(row.quantityMicros, 6)} shares × $${unitPrice(row.priceMicros)}`,
                      )
                      .join(" + ")}
                    . Excludes carry and remaining expenses; the provider mark
                    stays separate.
                  </p>
                  {estimate.proxy && (
                    <Collapsible>
                      <CollapsibleTrigger layout="inline">
                        Proxy assumptions <DisclosureIndicator />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {receipt.details.lots
                          .filter((lot) => lot.mark?.proxy)
                          .map((lot) => (
                            <p key={lot.id}>
                              {lot.mark!.sourceLabel} ·{" "}
                              {lot.mark!.shareClass ??
                                "Source share class unknown"}{" "}
                              applied to {lot.shareClass}.{" "}
                              {lot.mark!.proxy!.reason} Captured{" "}
                              {formatDate(
                                lot.mark!.proxy!.capturedAt.slice(0, 10),
                              )}
                              ;{" "}
                              {lot.mark!.effectiveDate
                                ? `mark dated ${formatDate(lot.mark!.effectiveDate)}`
                                : "mark date unknown"}
                              .
                            </p>
                          ))}
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                  {estimatedPerformance?.totalReturnPpm != null && (
                    <p>
                      Estimated return on cash contributed, before carry:{" "}
                      {percent(BigInt(estimatedPerformance.totalReturnPpm))}
                      %. Includes reported distributions and the recorded
                      upfront fees; not tax basis.
                    </p>
                  )}
                </div>
                {mode !== "valuation" && (
                  <Button tone="quiet" onClick={() => edit()}>
                    Update valuation
                  </Button>
                )}
              </div>
            ) : (
              mode !== "valuation" &&
              receipt.details.lots.length > 0 && (
                <div className="purchase-valuation-prompt">
                  <div>
                    <h4>Estimate your position</h4>
                    <p>
                      Add underlying shares, a purchase source and matching
                      price evidence for every purchase. Confirm that all
                      remaining shares are covered.
                    </p>
                  </div>
                  <Button tone="secondary" onClick={() => edit()}>
                    Add valuation details
                  </Button>
                </div>
              )
            ))}
        </>
      )}
      {mode === "valuation" && !open && !receipt?.details.lots.length && (
        <p>
          Add a purchase and its underlying share class in Purchase details
          first.
        </p>
      )}
      {open && noticeIndex !== null && (
        <form
          className="purchase-notice-form"
          onSubmit={(event) => {
            event.preventDefault();
            const input = PurchaseNoticeInputSchema.safeParse(noticeText);
            if (!input.success) return;
            const extracted = extractPurchaseNotice(input.data);
            // Prefill only blank fields; never overwrite an existing reviewed fact
            // or an in-progress edit when a notice is pasted.
            const numeric = new Set(["priceMicros", "referencePriceMicros"]);
            const rates = new Set([
              "feePpm",
              "reportedPremiumPpm",
              "reportedManagementFeePpm",
              "reportedCarryPpm",
            ]);
            setDrafts((old) =>
              old.map((draft, index) => {
                if (index !== noticeIndex) return draft;
                const next: Draft = {
                  ...draft,
                  sourceText: extracted.terms.sourceText ?? noticeText,
                };
                for (const [key, value] of Object.entries(extracted.terms)) {
                  if (key === "sourceText" || value == null || next[key])
                    continue;
                  next[key] =
                    typeof value === "number"
                      ? numeric.has(key)
                        ? unitPrice(value)
                        : decimal(value, rates.has(key) ? 4 : 2)
                      : typeof value === "string"
                        ? value
                        : "";
                }
                if (!draft.sourceText && !receipt?.details.lots[index])
                  next.sourceLabel = "GP notice";
                return next;
              }),
            );
            const providerTerms =
              holding.positionEconomicsContext?.reportedTerms;
            setTermDraft((old) => ({
              ...old,
              ...(!old.annualManagementFeePpm &&
              extracted.terms.reportedManagementFeePpm != null &&
              (providerTerms?.managementFeePpm == null ||
                providerTerms.managementFeePpm ===
                  extracted.terms.reportedManagementFeePpm)
                ? {
                    annualManagementFeePpm: decimal(
                      extracted.terms.reportedManagementFeePpm,
                      4,
                    ),
                  }
                : {}),
              ...(!old.carryPpm &&
              extracted.terms.reportedCarryPpm != null &&
              (providerTerms?.carryPpm == null ||
                providerTerms.carryPpm === extracted.terms.reportedCarryPpm)
                ? { carryPpm: decimal(extracted.terms.reportedCarryPpm, 4) }
                : {}),
            }));
            setNoticeWarnings(extracted.warnings);
            setNoticeIndex(null);
          }}
        >
          <p>
            Paste purchase terms for this SPV. Review the suggested fields
            before saving. Existing entries stay unchanged.
          </p>
          <Field label="Purchase notice" variant="filled">
            <Textarea
              aria-label="Purchase notice"
              rows={7}
              maxLength={12000}
              value={noticeText}
              onChange={(event) => setNoticeText(event.currentTarget.value)}
            />
          </Field>
          <ActionGroup wrap mobileLayout="stack">
            <Button
              type="submit"
              disabled={
                !PurchaseNoticeInputSchema.safeParse(noticeText).success
              }
            >
              Prefill purchase details
            </Button>
            <Button tone="secondary" onClick={() => setNoticeIndex(null)}>
              Enter manually
            </Button>
            <Button tone="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </ActionGroup>
        </form>
      )}
      {open && noticeIndex === null && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (canSave) void save();
          }}
        >
          {
            <p>
              Save what you know. Unknown amounts and fee rates may stay blank.
            </p>
          }
          {holding.positionEconomicsContext?.acceptedTerms && (
            <Collapsible>
              <CollapsibleTrigger layout="inline">
                Previous fee review <DisclosureIndicator />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p>
                  Previous review: management{" "}
                  {decimal(
                    holding.positionEconomicsContext.acceptedTerms
                      .annualAdminFeePpm,
                    4,
                  )}
                  % ×{" "}
                  {holding.positionEconomicsContext.acceptedTerms.adminFeeYears}{" "}
                  years; setup{" "}
                  {decimal(
                    holding.positionEconomicsContext.acceptedTerms.setupFeePpm,
                    4,
                  ) || "unknown"}
                  %; carry{" "}
                  {decimal(
                    holding.positionEconomicsContext.acceptedTerms.carryPpm,
                    4,
                  )}
                  %. Review one-time deductions and recurring fees separately
                  above.
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
          {context.sourceObservedOn && (
            <p>
              Source observed {formatDate(context.sourceObservedOn)}. This is
              not necessarily the current value’s valuation date.
            </p>
          )}
          {holding.positionEconomicsContext?.reportedTerms && (
            <Collapsible>
              <CollapsibleTrigger layout="inline">
                Provider terms observation <DisclosureIndicator />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p>
                  {holding.positionEconomicsContext.reportedTerms.sourceLabel} ·{" "}
                  {formatDate(
                    holding.positionEconomicsContext.reportedTerms.observedAt,
                  )}
                  . Management{" "}
                  {decimal(
                    holding.positionEconomicsContext.reportedTerms
                      .managementFeePpm,
                    4,
                  ) || "unknown"}
                  %; carry{" "}
                  {decimal(
                    holding.positionEconomicsContext.reportedTerms.carryPpm,
                    4,
                  ) || "unknown"}
                  %. Timing and basis require review.
                </p>
              </CollapsibleContent>
            </Collapsible>
          )}
          {noticeWarnings.length > 0 && (
            <Notice>{noticeWarnings.join(" ")}</Notice>
          )}
          <SectionHeader
            className="purchase-collection-heading"
            headingAs="h4"
            title="Purchases"
            description="Record each purchase or top-up separately."
            descriptionPlacement="title-group"
            action={
              <Button
                tone="secondary"
                disabled={busy || drafts.length >= 20}
                onClick={() => setDrafts((old) => [...old, blank(false)])}
              >
                Add another purchase
              </Button>
            }
          />
          {drafts.map((d, i) => (
            <Collapsible
              key={`${d.id}:${drafts.length === 1}`}
              render={<fieldset className="purchase-fields" />}
              defaultOpen={drafts.length === 1}
              disabled={busy}
            >
              <legend className="purchase-fields__heading">
                <CollapsibleTrigger layout="inline">
                  Purchase {i + 1} <DisclosureIndicator />
                </CollapsibleTrigger>
                {drafts.length > 1 && (
                  <Button
                    tone="quiet"
                    disabled={busy}
                    aria-label={`Remove purchase ${i + 1}`}
                    onClick={() => {
                      setRemoved((old) => [...old, { draft: d, index: i }]);
                      setDrafts((old) => old.filter((_, j) => j !== i));
                    }}
                  >
                    Remove purchase
                  </Button>
                )}
              </legend>
              {
                <CollapsibleContent
                  keepMounted
                  className="purchase-entry__content"
                >
                  {
                    <>
                      <h4>Cash and upfront deductions</h4>
                      <div className="position-economics__fields">
                        {field(i, "grossCashMinor", "Cash paid · USD", true)}
                        {field(
                          i,
                          "upfrontDeductionsMinor",
                          "Upfront deductions · USD",
                          true,
                        )}
                        {field(
                          i,
                          "netCapitalMinor",
                          "Net capital invested · USD",
                          true,
                        )}
                        {field(
                          i,
                          "nominalSpvUnitsMicros",
                          "Nominal SPV units (optional)",
                          true,
                        )}
                      </div>
                      {(() => {
                        const lot = PurchaseLotSchema.safeParse(lotFor(d));
                        const capital = lot.success
                          ? purchaseCapital(lot.data)
                          : null;
                        return (
                          capital && (
                            <p>
                              Cash paid{" "}
                              {capital.grossCashMinor === null
                                ? "unknown"
                                : money(capital.grossCashMinor)}
                              {lot.data?.capitalReturn?.status ===
                                "received" && (
                                <>
                                  {" "}
                                  − refund{" "}
                                  {money(lot.data.capitalReturn.amountMinor)}
                                </>
                              )}{" "}
                              − deductions{" "}
                              {capital.upfrontDeductionsMinor === null
                                ? "unknown"
                                : money(capital.upfrontDeductionsMinor)}{" "}
                              = net capital{" "}
                              {capital.netCapitalMinor === null
                                ? "unknown"
                                : money(capital.netCapitalMinor)}
                              . Enter any two amounts to calculate the third.
                            </p>
                          )
                        );
                      })()}
                      <Collapsible defaultOpen={Boolean(d.capitalReturnAmount)}>
                        <CollapsibleTrigger layout="inline">
                          Capital refund (optional) <DisclosureIndicator />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="position-economics__fields">
                            {field(
                              i,
                              "capitalReturnAmount",
                              "Capital refund · USD",
                              true,
                            )}
                            <Field
                              label="Capital refund status"
                              variant="filled"
                            >
                              <Select
                                items={[
                                  { value: "expected", label: "Expected" },
                                  { value: "received", label: "Received" },
                                ]}
                                value={d.capitalReturnStatus || "expected"}
                                onValueChange={(v) =>
                                  update(i, "capitalReturnStatus", String(v))
                                }
                              >
                                <SelectTrigger aria-label="Capital refund status">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="expected">
                                    Expected
                                  </SelectItem>
                                  <SelectItem value="received">
                                    Received
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            {date(
                              i,
                              "capitalReturnDate",
                              d.capitalReturnStatus === "received"
                                ? "Capital refund received on"
                                : "Capital refund expected on (optional)",
                            )}
                            {d.capitalReturnStatus === "received" && (
                              <Field
                                label="Refund in provider distributions"
                                variant="filled"
                              >
                                <Select
                                  items={[
                                    { value: "unknown", label: "Unknown" },
                                    {
                                      value: "included",
                                      label: "Already included",
                                    },
                                    {
                                      value: "excluded",
                                      label: "Not included",
                                    },
                                  ]}
                                  value={
                                    d.capitalReturnDistributions || "unknown"
                                  }
                                  onValueChange={(v) =>
                                    update(
                                      i,
                                      "capitalReturnDistributions",
                                      String(v),
                                    )
                                  }
                                >
                                  <SelectTrigger aria-label="Refund in provider distributions">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="unknown">
                                      Unknown
                                    </SelectItem>
                                    <SelectItem value="included">
                                      Already included
                                    </SelectItem>
                                    <SelectItem value="excluded">
                                      Not included
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </Field>
                            )}
                          </div>
                          <p>
                            Use this for uninvested cash returned after an
                            allocation cutback. Expected refunds affect the
                            estimate only. Received refunds reduce cash
                            available for investment; they are not fees.
                          </p>
                        </CollapsibleContent>
                      </Collapsible>
                      <p>
                        SPV units represent your interest in the vehicle. They
                        are not company shares; no conversion is inferred.
                      </p>
                      <Collapsible>
                        <CollapsibleTrigger layout="inline">
                          Underlying shares and source evidence (optional){" "}
                          <DisclosureIndicator />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <Button
                            tone="quiet"
                            onClick={() => {
                              setNoticeIndex(i);
                              setNoticeText(d.sourceText ?? "");
                            }}
                          >
                            Paste GP notice
                          </Button>
                          <div className="position-economics__fields">
                            <Field label="Transaction type" variant="filled">
                              <Select
                                items={[
                                  { value: "unknown", label: "Not specified" },
                                  { value: "primary", label: "Primary" },
                                  { value: "secondary", label: "Secondary" },
                                ]}
                                value={d.transactionType || "unknown"}
                                onValueChange={(v) =>
                                  update(
                                    i,
                                    "transactionType",
                                    v === "unknown" ? "" : String(v),
                                  )
                                }
                              >
                                <SelectTrigger aria-label="Transaction type">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unknown">
                                    Not specified
                                  </SelectItem>
                                  <SelectItem value="primary">
                                    Primary
                                  </SelectItem>
                                  <SelectItem value="secondary">
                                    Secondary
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            {date(i, "purchasedOn", "Purchase date")}
                            {field(i, "shareClass", "Underlying share class")}
                            {field(
                              i,
                              "priceMicros",
                              "Purchase price / share · USD",
                              true,
                            )}
                            {field(i, "feePpm", "One-time fee · %", true)}
                            <Field label="Fee basis" variant="filled">
                              <Select
                                items={feeChoices}
                                value={d.feeBasis || "unknown"}
                                onValueChange={(v) =>
                                  update(
                                    i,
                                    "feeBasis",
                                    v === "unknown" ? "" : String(v),
                                  )
                                }
                              >
                                <SelectTrigger aria-label="Fee basis">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {feeChoices.map((choice) => (
                                    <SelectItem
                                      key={choice.value}
                                      value={choice.value}
                                    >
                                      {choice.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </Field>
                            {field(i, "feeLabel", "Fee description")}
                            {field(
                              i,
                              "referencePriceMicros",
                              "Entry reference price / share · USD",
                              true,
                            )}
                            {field(i, "referenceRound", "Reference round")}
                            {field(
                              i,
                              "reportedPremiumPpm",
                              "Notice-quoted premium · %",
                              true,
                            )}
                            <Field label="Evidence type" variant="filled">
                              <Select
                                items={[
                                  { value: "unknown", label: "Unknown" },
                                  {
                                    value: "executed",
                                    label: "Executed / paid",
                                  },
                                  {
                                    value: "deal_snapshot",
                                    label: "Historical deal snapshot",
                                  },
                                  { value: "other", label: "Other" },
                                ]}
                                value={d.sourceKind || "unknown"}
                                onValueChange={(v) =>
                                  update(i, "sourceKind", String(v))
                                }
                              >
                                <SelectTrigger aria-label="Evidence type">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unknown">
                                    Unknown
                                  </SelectItem>
                                  <SelectItem value="executed">
                                    Executed / paid
                                  </SelectItem>
                                  <SelectItem value="deal_snapshot">
                                    Historical deal snapshot
                                  </SelectItem>
                                  <SelectItem value="other">Other</SelectItem>
                                </SelectContent>
                              </Select>
                            </Field>
                            {date(
                              i,
                              "sourceObservedOn",
                              "Evidence date (optional)",
                            )}
                            {field(i, "sourceLabel", "Purchase source")}
                            {field(i, "sourceUrl", "Purchase source link")}
                          </div>
                          <p>
                            The one-time fee previews net capital when final
                            amounts are unknown. Entered upfront totals take
                            precedence; annual management fees and carry stay
                            separate.
                          </p>
                          {(() => {
                            const lot = PurchaseLotSchema.safeParse(lotFor(d));
                            return lot.success ? (
                              <PurchaseCapitalPreview lot={lot.data} />
                            ) : null;
                          })()}
                          {(d.reportedManagementFeePpm ||
                            d.reportedCarryPpm) && (
                            <Notice>
                              Source notice reports management{" "}
                              {d.reportedManagementFeePpm
                                ? `${d.reportedManagementFeePpm}% (timing and basis require review)`
                                : "unknown"}
                              ; carry {d.reportedCarryPpm || "unknown"}
                              {d.reportedCarryPpm ? "%" : ""}. The reviewed
                              terms below drive calculations.
                              {d.reportedCarryPpm &&
                                termDraft.carryPpm &&
                                d.reportedCarryPpm !== termDraft.carryPpm &&
                                " The notice carry differs from your reviewed rate; saving records your chosen rate."}
                              <Button
                                tone="quiet"
                                disabled={
                                  !d.reportedCarryPpm ||
                                  d.reportedCarryPpm === termDraft.carryPpm
                                }
                                onClick={() =>
                                  setTermDraft((old) => ({
                                    ...old,
                                    carryPpm: d.reportedCarryPpm ?? "",
                                  }))
                                }
                              >
                                Use notice carry rate
                              </Button>
                            </Notice>
                          )}
                          {d.sourceText && (
                            <Collapsible>
                              <CollapsibleTrigger layout="inline">
                                Original purchase notice <DisclosureIndicator />
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <p className="purchase-notice-text">
                                  {d.sourceText}
                                </p>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    </>
                  }
                  {mode !== "purchase" && (
                    <Collapsible>
                      <CollapsibleTrigger layout="inline">
                        Remaining underlying shares (optional){" "}
                        <DisclosureIndicator />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="position-economics__fields">
                          {field(
                            i,
                            "remainingSharesMicros",
                            "Remaining underlying shares",
                            true,
                          )}
                          {date(i, "sharesAsOf", "Shares as of")}
                          <label className="purchase-coverage">
                            <Input
                              type="checkbox"
                              checked={d.originalSharesUnchanged === "true"}
                              onChange={(event) =>
                                update(
                                  i,
                                  "originalSharesUnchanged",
                                  String(event.currentTarget.checked),
                                )
                              }
                            />
                            No sales, splits or conversions; original shares are
                            still held.
                          </label>
                          <p className="purchase-fields__hint">
                            Confirmed original shares use net capital ÷ purchase
                            price. Nominal SPV units are never converted into
                            underlying shares.
                          </p>
                          <p className="purchase-fields__hint">
                            Share count is optional. If entered, its date is
                            required.
                          </p>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}

                  {mode !== "purchase" && (
                    <Collapsible
                      onOpenChange={(next) => {
                        setPriceEvidenceOpen(next);
                        if (next) {
                          setLoadingEvidence(true);
                          setEvidenceError(null);
                        }
                      }}
                    >
                      <CollapsibleTrigger layout="inline">
                        Valuation price evidence <DisclosureIndicator />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {(loadingEvidence ||
                          evidenceError ||
                          priceEvidence.some(
                            (item) => item.markMicros !== null,
                          ) ||
                          watchEvidence.length > 0) && (
                          <Collapsible>
                            <CollapsibleTrigger layout="inline">
                              Available share price evidence{" "}
                              <DisclosureIndicator />
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              {loadingEvidence && (
                                <p>Loading price evidence…</p>
                              )}
                              {evidenceError && (
                                <Notice tone="error">{evidenceError}</Notice>
                              )}
                              {!loadingEvidence &&
                                !evidenceError &&
                                !priceEvidence.some(
                                  (item) => item.markMicros !== null,
                                ) && (
                                  <p>
                                    No imported share prices yet. Refresh the
                                    provider source with the updated capture
                                    agent, or enter a dated price below.
                                  </p>
                                )}
                              {priceEvidence
                                .filter((item) => item.markMicros !== null)
                                .map((item) => (
                                  <div key={item.id}>
                                    <p>
                                      <strong>
                                        {item.sourceLabel} · $
                                        {unitPrice(item.markMicros)} / share
                                      </strong>{" "}
                                      ·{" "}
                                      {item.markDate
                                        ? formatDate(item.markDate)
                                        : "Mark date not reported"}
                                      <br />
                                      {item.positionLabel} ·{" "}
                                      {item.shareClass ??
                                        "Share class not reported"}
                                    </p>
                                    <Button
                                      tone="quiet"
                                      disabled={Boolean(
                                        item.shareClass &&
                                        d.shareClass &&
                                        item.shareClass.toLowerCase() !==
                                          d.shareClass.toLowerCase(),
                                      )}
                                      onClick={() =>
                                        setDrafts((old) =>
                                          old.map((draft, index) =>
                                            index !== i
                                              ? draft
                                              : {
                                                  ...draft,
                                                  markPrice: unitPrice(
                                                    item.markMicros,
                                                  ),
                                                  markDate: item.markDate ?? "",
                                                  markClass:
                                                    item.shareClass ?? "",
                                                  markSource: `${item.sourceLabel} · ${item.positionLabel}`,
                                                  markEvidenceId: item.id,
                                                  markComparable: "false",
                                                  markProxy: "false",
                                                  proxyReason: "",
                                                },
                                          ),
                                        )
                                      }
                                    >
                                      Use this price
                                    </Button>
                                    <Button
                                      tone="quiet"
                                      onClick={() => {
                                        setCoversPosition(false);
                                        setDrafts((old) =>
                                          old.map((draft, index) =>
                                            index !== i
                                              ? draft
                                              : {
                                                  ...draft,
                                                  markPrice: unitPrice(
                                                    item.markMicros,
                                                  ),
                                                  markDate: item.markDate ?? "",
                                                  markClass:
                                                    item.shareClass ?? "",
                                                  markSource: `${item.sourceLabel} · ${item.positionLabel}`,
                                                  markEvidenceId: item.id,
                                                  markComparable: "false",
                                                  markProxy: "true",
                                                  proxyReason: "",
                                                  markCapturedAt:
                                                    item.capturedAt,
                                                },
                                          ),
                                        );
                                      }}
                                    >
                                      Use as proxy estimate
                                    </Button>
                                    {item.shareClass &&
                                      d.shareClass &&
                                      item.shareClass.toLowerCase() !==
                                        d.shareClass.toLowerCase() && (
                                        <p>
                                          Different share class. Use a proxy or
                                          provide a matching price.
                                        </p>
                                      )}
                                  </div>
                                ))}
                              {watchEvidence.length > 0 && (
                                <Collapsible>
                                  <CollapsibleTrigger layout="inline">
                                    Portfolio Watch context{" "}
                                    <DisclosureIndicator />
                                  </CollapsibleTrigger>
                                  <CollapsibleContent>
                                    {watchEvidence.map((item) => (
                                      <p key={item.id}>
                                        <TextLink
                                          href={item.url}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          {item.title}
                                        </TextLink>{" "}
                                        ·{" "}
                                        {formatDate(
                                          item.publishedAt.slice(0, 10),
                                        )}
                                        <br />
                                        {item.fact}
                                      </p>
                                    ))}
                                  </CollapsibleContent>
                                </Collapsible>
                              )}
                              {d.markProxy === "true" && (
                                <>
                                  <Notice>
                                    Proxy estimate · The price may be for a
                                    different share class.{" "}
                                    {d.markDate ? "" : "Mark date unknown. "}
                                    Captured{" "}
                                    {formatDate(
                                      (d.markCapturedAt ?? "").slice(0, 10),
                                    )}
                                    ; not a mark date.
                                  </Notice>
                                  <Field
                                    label="Note (optional)"
                                    variant="filled"
                                  >
                                    <Textarea
                                      aria-label="Note (optional)"
                                      value={d.proxyReason}
                                      onChange={(event) =>
                                        update(
                                          i,
                                          "proxyReason",
                                          event.currentTarget.value,
                                        )
                                      }
                                    />
                                  </Field>
                                </>
                              )}
                              {d.markEvidenceId && d.markProxy !== "true" && (
                                <label>
                                  <Input
                                    type="checkbox"
                                    checked={d.markComparable === "true"}
                                    onChange={(event) =>
                                      update(
                                        i,
                                        "markComparable",
                                        String(event.currentTarget.checked),
                                      )
                                    }
                                  />{" "}
                                  I confirmed this price applies to the same
                                  underlying share class.
                                </label>
                              )}
                              <p>
                                Portfolio Watch company valuations provide
                                context. This calculation uses per-share price
                                evidence.
                              </p>
                            </CollapsibleContent>
                          </Collapsible>
                        )}
                        <div className="position-economics__fields">
                          {field(
                            i,
                            "markPrice",
                            "Valuation price / share · USD",
                            true,
                          )}
                          {date(i, "markDate", "Valuation price as of")}
                          {field(i, "markClass", "Valuation share class")}
                          {field(i, "markSource", "Valuation source")}
                          {field(i, "markUrl", "Valuation source link")}
                        </div>
                        <p>
                          {d.markProxy === "true"
                            ? "For a proxy, leave the mark date or source share class blank if unknown. Saving records your choice to use this price despite those limitations."
                            : "A valuation price needs a date, matching share class and source. The source link is optional. A company valuation or another preferred series is not a matching share price."}
                        </p>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </CollapsibleContent>
              }
            </Collapsible>
          ))}
          {
            <InvestmentTermsFields
              draft={termDraft}
              update={(key, value) =>
                setTermDraft((old) => ({ ...old, [key]: value }))
              }
              importedMinor={
                holding.positionEconomicsContext?.committedMinor ?? null
              }
              reportedValueMinor={reportedValueMinor}
              reportedSource={reportedSource}
            />
          }
          {
            <label className="purchase-coverage">
              <Input
                type="checkbox"
                checked={cashCoversPosition}
                onChange={(event) =>
                  setCashCoversPosition(event.currentTarget.checked)
                }
              />
              These purchases include all cash paid for this position.
            </label>
          }
          {parsed.success && (
            <InvestmentCalculationPreview
              reviewed={reviewedInvestmentFromReceipt({
                id: "draft",
                positionId: holding.id,
                snapshotId: context.snapshotId,
                currency: "USD",
                acceptedAt: new Date().toISOString(),
                details: parsed.data.details,
              })!}
              reportedValueMinor={reportedValueMinor}
              currentReportedValueSnapshotId={
                context.reportedValueSnapshotId ??
                holding.linkedReportedValue?.snapshotId ??
                context.snapshotId
              }
              currentSnapshotId={context.snapshotId}
            />
          )}
          {mode !== "purchase" && (
            <label className="purchase-coverage">
              <Input
                type="checkbox"
                checked={coversPosition}
                onChange={(event) =>
                  setCoversPosition(event.currentTarget.checked)
                }
              />{" "}
              These purchases cover all my remaining shares in this SPV.
            </label>
          )}

          {drafts.some(
            (d) =>
              d.markEvidenceId &&
              d.markProxy !== "true" &&
              d.markComparable !== "true",
          ) && (
            <Notice>
              Confirm that the selected price applies to your underlying share
              class before saving.
            </Notice>
          )}
          {!parsed.success &&
            !drafts.some(
              (d) =>
                d.markEvidenceId &&
                d.markProxy !== "true" &&
                d.markComparable !== "true",
            ) && (
              <Notice tone="error">{parsed.error.issues[0]?.message}</Notice>
            )}
          {removed.map(({ draft, index }) => (
            <Notice key={draft.id}>
              {draft.shareClass || "Purchase"} removed from this draft.{" "}
              <Button
                tone="quiet"
                disabled={busy || drafts.length >= 20}
                onClick={() => {
                  setDrafts((old) => {
                    const next = [...old];
                    next.splice(Math.min(index, next.length), 0, draft);
                    return next;
                  });
                  setRemoved((old) =>
                    old.filter((row) => row.draft.id !== draft.id),
                  );
                }}
              >
                Undo
              </Button>
            </Notice>
          ))}
          <ActionGroup
            className="purchase-actions"
            align="end"
            wrap
            mobileLayout="stack"
          >
            <Button tone="quiet" disabled={busy} onClick={() => setOpen(false)}>
              {"Cancel"}
            </Button>
            <Button tone="primary" type="submit" disabled={!canSave}>
              {busy ? "Saving…" : "Save investment details"}
            </Button>
          </ActionGroup>
        </form>
      )}
    </section>
  );
}
