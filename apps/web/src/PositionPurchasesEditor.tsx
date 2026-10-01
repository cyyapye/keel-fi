import { useEffect, useRef, useState } from "react";
import type { Holding } from "@keel/domain";
import {
  AcceptPurchasesSchema,
  type SharePriceEvidenceListSchema,
  PositionValuationEvidenceSchema,
  prefillPurchaseCapital,
  PurchaseReceiptSchema,
  PurchaseLotSchema,
  estimatePurchaseValue,
  purchaseCapital,
  purchaseShares,
  purchaseAllInPrice,
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
    purchasedOn: lot.purchasedOn ?? "",
    shareClass: lot.shareClass ?? "",
    priceMicros: unitPrice(lot.priceMicros),
    referencePriceMicros: unitPrice(lot.referencePriceMicros),
    grossCashMinor: decimal(lot.grossCashMinor, 2),
    netCapitalMinor: decimal(lot.netCapitalMinor, 2),
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
    purchasedOn: d.purchasedOn || null,
    shareClass: d.shareClass || null,
    priceMicros: scaled(d.priceMicros, 6),
    referencePriceMicros: scaled(d.referencePriceMicros, 6),
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

export function PositionPurchasesEditor({
  holding,
  onAccepted,
  mode = "combined",
  onDirtyChange,
}: {
  holding: Pick<
    Holding,
    | "id"
    | "sourceLabel"
    | "purchaseContext"
    | "positionEconomicsContext"
    | "realizedValueMinor"
  >;
  onAccepted: () => Promise<void>;
  mode?: "combined" | "purchase" | "valuation";
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const context = holding.purchaseContext;
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(
    context?.receipt ?? null,
  );
  const [coversPosition, setCoversPosition] = useState(
    receipt?.details.coversPosition ?? false,
  );
  const automaticEntry =
    mode === "valuation" &&
    Boolean(receipt?.details.lots.length) &&
    !estimatePurchaseValue(receipt, context?.snapshotId ?? "");
  const [editing, setOpen] = useState(false);
  const open = editing || automaticEntry;
  const [valuationOnly, setValuationOnly] = useState(mode === "valuation");
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    automaticEntry
      ? prefillPurchaseCapital(receipt!, holding.positionEconomicsContext).map(
          draftFor,
        )
      : [],
  );
  const [priceEvidence, setPriceEvidence] = useState<
    ReturnType<typeof SharePriceEvidenceListSchema.parse>
  >([]);
  const [watchEvidence, setWatchEvidence] = useState<
    ReturnType<typeof PositionValuationEvidenceSchema.parse>["watch"]
  >([]);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(true);
  useEffect(() => {
    if (!open || !valuationOnly) return;
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
  }, [open, valuationOnly, holding.id]);
  const [removed, setRemoved] = useState<{ draft: Draft; index: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeIndex, setNoticeIndex] = useState<number | null>(null);
  const [noticeText, setNoticeText] = useState("");
  const [noticeWarnings, setNoticeWarnings] = useState<string[]>([]);
  const sharesInput = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (editing && valuationOnly) sharesInput.current?.focus();
    else if (!open && wasOpen.current) editButton.current?.focus();
    wasOpen.current = open;
  }, [open, editing, valuationOnly]);
  useEffect(() => {
    onDirtyChange?.(
      open &&
        (coversPosition !== (receipt?.details.coversPosition ?? false) ||
          JSON.stringify(drafts.map(lotFor)) !==
            JSON.stringify(
              receipt
                ? prefillPurchaseCapital(
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
    holding.positionEconomicsContext,
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
  const parsed = AcceptPurchasesSchema.safeParse({
    expectedSnapshotId: context.snapshotId,
    expectedReceiptId: receipt?.id ?? null,
    details: { coversPosition, lots: drafts.map(lotFor) },
  });
  const changed =
    parsed.success &&
    (receipt?.snapshotId !== context.snapshotId ||
      JSON.stringify(parsed.data.details) !==
        JSON.stringify(
          receipt?.details ?? { coversPosition: false, lots: [] },
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
  const draftEstimate = parsed.success
    ? estimatePurchaseValue(
        {
          id: receipt?.id ?? "draft",
          positionId: holding.id,
          snapshotId: context.snapshotId,
          currency: "USD",
          acceptedAt: receipt?.acceptedAt ?? new Date().toISOString(),
          details: parsed.data.details,
        },
        context.snapshotId,
      )
    : null;
  const compactProxy =
    valuationOnly && drafts.length === 1 && drafts[0]?.markProxy === "true";
  // Preview the proposed assumption without accepting it in the saved draft.
  const previewDetails = compactProxy
    ? AcceptPurchasesSchema.safeParse({
        expectedSnapshotId: context.snapshotId,
        expectedReceiptId: receipt?.id ?? null,
        details: {
          coversPosition: true,
          lots: drafts.map((d) =>
            lotFor({ ...d, originalSharesUnchanged: "true" }),
          ),
        },
      })
    : null;
  const proxyPreview = previewDetails?.success
    ? estimatePurchaseValue(
        {
          id: receipt?.id ?? "preview",
          positionId: holding.id,
          snapshotId: context.snapshotId,
          currency: "USD",
          acceptedAt: receipt?.acceptedAt ?? new Date().toISOString(),
          details: previewDetails.data.details,
        },
        context.snapshotId,
      )
    : null;
  const canSave =
    parsed.success &&
    changed &&
    !busy &&
    (!compactProxy || Boolean(draftEstimate));
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
        ref={
          i === 0 && key === "remainingSharesMicros" ? sharesInput : undefined
        }
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
  const edit = (valuation = false) => {
    setRemoved([]);
    setCoversPosition(receipt?.details.coversPosition ?? false);
    setDrafts(
      receipt?.details.lots.length
        ? prefillPurchaseCapital(receipt, holding.positionEconomicsContext).map(
            draftFor,
          )
        : [blank(true)],
    );
    setError(null);
    setNoticeIndex(null);
    setNoticeWarnings([]);
    if (valuation) {
      setLoadingEvidence(true);
      setEvidenceError(null);
    }
    setValuationOnly(valuation);
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
      className="position-economics purchase-details"
      aria-label={
        mode === "valuation" ? "Share-based valuation" : "Purchase details"
      }
    >
      {mode === "valuation" && !compactProxy && (
        <p>
          Remaining shares × a matching share price or an explicitly chosen
          proxy. Before carry and remaining expenses; does not replace a
          reported mark.
        </p>
      )}
      <div className="position-economics__heading">
        <div>
          {mode !== "valuation" && (
            <h3>
              {open && valuationOnly
                ? "Value your position"
                : "Purchase details"}
            </h3>
          )}
          {(open || !receipt?.details.lots.length) && mode !== "valuation" && (
            <p>
              {valuationOnly
                ? "Use your remaining company shares with a matching price or a proxy estimate."
                : "Optional. Record the underlying shares attributable to this SPV investment."}
            </p>
          )}
        </div>
        {!open && (
          <ActionGroup wrap mobileLayout="stack">
            <Button
              tone={receipt?.details.lots.length ? "quiet" : "secondary"}
              ref={editButton}
              disabled={mode === "valuation" && !receipt?.details.lots.length}
              onClick={() => edit(mode === "valuation")}
            >
              {mode === "valuation"
                ? estimate
                  ? "Edit share calculation"
                  : "Add share details"
                : receipt?.details.lots.length
                  ? "Edit purchases"
                  : "Add purchase details"}
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
          The source position changed. Review the remaining shares before using
          a share price estimate.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {!open && receipt && (
        <>
          {mode !== "valuation" &&
            receipt.details.lots.map((lot, i) => {
              const shares = purchaseShares(lot);
              const capital = purchaseCapital(lot);
              const allIn = purchaseAllInPrice(lot);
              return (
                <div key={lot.id} className="purchase-summary">
                  {receipt.details.lots.length > 1 && <h4>Purchase {i + 1}</h4>}
                  <p className="purchase-summary__metadata">
                    {[
                      lot.shareClass,
                      lot.transactionType
                        ? lot.transactionType === "secondary"
                          ? "Secondary"
                          : "Primary"
                        : null,
                      lot.purchasedOn ? formatDate(lot.purchasedOn) : null,
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
                                lot.feePpm !== null && lot.feeBasis
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
                      {lot.feeLabel && <p>Upfront fee: {lot.feeLabel}.</p>}
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
                                      label="Management / year"
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
                          label="Cash used for purchase"
                          value={money(capital.grossCashMinor)}
                        />
                      )}
                      {capital.netCapitalMinor !== null && (
                        <DataItem
                          label="Share capital"
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
                  <Button tone="quiet" onClick={() => edit(true)}>
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
                      Add remaining shares and choose a price to estimate value.
                    </p>
                  </div>
                  <Button tone="secondary" onClick={() => edit(true)}>
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
          {!valuationOnly && (
            <p>
              All purchase fields are optional. Save what you know; leave
              unknown amounts blank. Related details are only needed for
              calculations.
            </p>
          )}
          {noticeWarnings.length > 0 && (
            <Notice>{noticeWarnings.join(" ")}</Notice>
          )}
          {drafts.map((d, i) => (
            <fieldset key={d.id} className="purchase-fields">
              <legend className="purchase-fields__heading">
                <span>
                  {drafts.length > 1
                    ? `Purchase ${i + 1}`
                    : d.shareClass || "Underlying shares"}
                </span>
                {!valuationOnly && (
                  <Button
                    tone="quiet"
                    disabled={busy}
                    aria-label={`Remove purchase ${i + 1}`}
                    onClick={() => {
                      setRemoved((old) => [...old, { draft: d, index: i }]);
                      setDrafts((old) => old.filter((_, j) => j !== i));
                    }}
                  >
                    Remove
                  </Button>
                )}
              </legend>
              {compactProxy ? (
                <div className="purchase-proxy-confirmation">
                  {proxyPreview ? (
                    <>
                      <Stat
                        label="Estimated value · proxy"
                        value={money(proxyPreview.valueMinor)}
                      />
                      <p>
                        {decimal(proxyPreview.lots[0]?.quantityMicros, 6)}{" "}
                        shares ×{" "}
                        {displayedUnitPrice(proxyPreview.lots[0]?.priceMicros)}.
                        Before carry and remaining expenses.
                      </p>
                    </>
                  ) : (
                    <Notice>
                      Add a valid share count and date under Adjust shares to
                      calculate this estimate.
                    </Notice>
                  )}
                  <p>
                    {d.markSource}. The price may be for a different share
                    class.{!d.markDate && " Mark date unknown."}
                  </p>
                  <label className="purchase-coverage">
                    <Input
                      type="checkbox"
                      checked={
                        coversPosition &&
                        (Boolean(d.remainingSharesMicros) ||
                          d.originalSharesUnchanged === "true")
                      }
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setCoversPosition(checked);
                        update(
                          i,
                          "originalSharesUnchanged",
                          String(checked && !d.remainingSharesMicros),
                        );
                      }}
                    />
                    {d.remainingSharesMicros
                      ? "These are all my remaining shares in this SPV."
                      : "Use my calculated shares as my full remaining position; no sales, splits or conversions."}
                  </label>
                  <Collapsible>
                    <CollapsibleTrigger layout="inline">
                      Adjust shares <DisclosureIndicator />
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
                      </div>
                      <p>
                        Optional. Enter the actual remaining shares and their
                        date to replace the calculated count.
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                  <Collapsible>
                    <CollapsibleTrigger layout="inline">
                      Details <DisclosureIndicator />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p>
                        Price: {displayedUnitPrice(scaled(d.markPrice, 6))} per
                        share · {d.markClass || "Share class unknown"} ·{" "}
                        {d.markDate
                          ? formatDate(d.markDate)
                          : "Mark date unknown"}
                        .
                      </p>
                      <p>
                        Captured{" "}
                        {formatDate((d.markCapturedAt ?? "").slice(0, 10))};
                        capture date is not the mark date. Calculated shares use
                        capital after fees divided by purchase price.
                      </p>
                      <p>
                        Applying records your choice to use the closest
                        available imported share price. It does not replace a
                        reported value.
                      </p>
                      <Field label="Note (optional)" variant="filled">
                        <Textarea
                          aria-label="Note (optional)"
                          value={d.proxyReason}
                          onChange={(event) =>
                            update(i, "proxyReason", event.currentTarget.value)
                          }
                        />
                      </Field>
                      <Button
                        tone="quiet"
                        onClick={() => update(i, "markProxy", "false")}
                      >
                        Choose another price
                      </Button>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ) : (
                <>
                  {!valuationOnly && (
                    <>
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
                              <SelectItem value="primary">Primary</SelectItem>
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
                        {field(
                          i,
                          "reportedManagementFeePpm",
                          "Reported annual management fee · %",
                          true,
                        )}
                        {field(
                          i,
                          "reportedCarryPpm",
                          "Reported carry · %",
                          true,
                        )}
                        {field(i, "sourceLabel", "Purchase source")}
                      </div>
                      <p>
                        Known management fee and carry prefill fee &amp; carry
                        review. Conflicting sources need your review.
                      </p>
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
                    </>
                  )}
                  {valuationOnly && (
                    <div>
                      <p>
                        Confirm that the original shares are still held, or
                        enter the GP's actual allocation below.
                      </p>
                      <label>
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
                        />{" "}
                        No sales, splits or conversions; original shares are
                        still held.
                      </label>
                      {(() => {
                        const lot = PurchaseLotSchema.safeParse({
                          ...lotFor(d),
                          mark: null,
                          remainingSharesMicros: null,
                          originalSharesUnchanged: true,
                        });
                        const shares = lot.success
                          ? purchaseShares(lot.data)
                          : null;
                        return shares ? (
                          <p>
                            Estimated original shares:{" "}
                            <strong>{decimal(shares.quantityMicros, 6)}</strong>{" "}
                            · capital ÷ purchase price. An entered remaining
                            share count takes precedence.
                          </p>
                        ) : null;
                      })()}
                      {loadingEvidence && <p>Loading price evidence…</p>}
                      {evidenceError && (
                        <Notice tone="error">{evidenceError}</Notice>
                      )}
                      {!loadingEvidence &&
                        !evidenceError &&
                        !priceEvidence.some(
                          (item) => item.markMicros !== null,
                        ) && (
                          <p>
                            No imported share prices yet. Refresh the provider
                            source with the updated capture agent, or enter a
                            dated price below.
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
                              {item.shareClass ?? "Share class not reported"}
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
                                          markPrice: unitPrice(item.markMicros),
                                          markDate: item.markDate ?? "",
                                          markClass: item.shareClass ?? "",
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
                                          markPrice: unitPrice(item.markMicros),
                                          markDate: item.markDate ?? "",
                                          markClass: item.shareClass ?? "",
                                          markSource: `${item.sourceLabel} · ${item.positionLabel}`,
                                          markEvidenceId: item.id,
                                          markComparable: "false",
                                          markProxy: "true",
                                          proxyReason: "",
                                          markCapturedAt: item.capturedAt,
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
                                  Different share class. Use a proxy or provide
                                  a matching price.
                                </p>
                              )}
                          </div>
                        ))}
                      {watchEvidence.length > 0 && (
                        <Collapsible>
                          <CollapsibleTrigger layout="inline">
                            Portfolio Watch context <DisclosureIndicator />
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
                                · {formatDate(item.publishedAt.slice(0, 10))}
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
                            Proxy estimate · The price may be for a different
                            share class.{" "}
                            {d.markDate ? "" : "Mark date unknown. "}Captured{" "}
                            {formatDate((d.markCapturedAt ?? "").slice(0, 10))};
                            not a mark date.
                          </Notice>
                          <Field label="Note (optional)" variant="filled">
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
                          I confirmed this price applies to the same underlying
                          share class.
                        </label>
                      )}
                      <p>
                        Portfolio Watch company valuations provide context. This
                        calculation uses per-share price evidence.
                      </p>
                    </div>
                  )}
                  {mode !== "purchase" && (
                    <div className="position-economics__fields">
                      {valuationOnly &&
                        !receipt?.details.lots[i]?.shareClass &&
                        field(i, "shareClass", "Underlying share class")}
                      {field(
                        i,
                        "remainingSharesMicros",
                        "Remaining underlying shares",
                        true,
                      )}
                      {date(i, "sharesAsOf", "Shares as of")}
                      <p className="purchase-fields__hint">
                        Share count is optional. If entered, its date is
                        required.
                      </p>
                    </div>
                  )}
                  <Collapsible>
                    <CollapsibleTrigger layout="inline">
                      Capital and share calculation <DisclosureIndicator />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="position-economics__fields">
                        {field(
                          i,
                          "grossCashMinor",
                          "Gross cash contributed · USD",
                          true,
                        )}
                        {field(
                          i,
                          "netCapitalMinor",
                          "Capital used for shares · USD",
                          true,
                        )}
                        {field(i, "sourceUrl", "Purchase source link")}
                      </div>
                      {!valuationOnly && (
                        <label>
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
                          />{" "}
                          No sales, splits or conversions; original shares are
                          still held.
                        </label>
                      )}
                      <p>
                        Without a remaining share count, Keel can calculate
                        original shares from share capital and purchase price.
                        Only use that calculation if there have been no sales,
                        splits or conversions. These details do not replace fee
                        and carry terms.
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                  {mode !== "purchase" && (
                    <Collapsible defaultOpen={valuationOnly}>
                      <CollapsibleTrigger layout="inline">
                        Valuation price evidence <DisclosureIndicator />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
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
                </>
              )}
            </fieldset>
          ))}
          {mode !== "purchase" && !compactProxy && (
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
          {valuationOnly && !compactProxy && draftEstimate && (
            <Notice>
              {draftEstimate.proxy
                ? "Estimated value · proxy: "
                : "Estimated gross value: "}
              <strong>{money(draftEstimate.valueMinor)}</strong> · before carry
              and remaining expenses.{" "}
              {draftEstimate.effectiveDate
                ? `As of ${formatDate(draftEstimate.effectiveDate)}.`
                : "Mark date unknown."}
            </Notice>
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
          {!valuationOnly && drafts.length < 20 && (
            <Button
              className="purchase-add"
              tone="quiet"
              onClick={() => setDrafts((old) => [...old, blank(false)])}
            >
              + Add another purchase
            </Button>
          )}
          <ActionGroup
            className="purchase-actions"
            align="end"
            wrap
            mobileLayout="stack"
          >
            <Button
              tone="quiet"
              disabled={busy}
              onClick={() => (automaticEntry ? edit(true) : setOpen(false))}
            >
              {automaticEntry ? "Reset" : "Cancel"}
            </Button>
            <Button tone="primary" type="submit" disabled={!canSave}>
              {busy
                ? "Saving…"
                : compactProxy
                  ? "Apply proxy estimate"
                  : valuationOnly
                    ? "Save valuation details"
                    : "Save purchase details"}
            </Button>
          </ActionGroup>
        </form>
      )}
    </section>
  );
}
