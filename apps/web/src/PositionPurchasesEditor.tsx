import { useState } from "react";
import type { Holding } from "@keel/domain";
import {
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
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
import { calculatePositionEconomics } from "@keel/domain/position-economics";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  DisclosureIndicator,
  ActionGroup,
  Button,
  DatePicker,
  Field,
  Input,
  Notice,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatGroup,
} from "@keel/ui";
import { formatCurrency, formatDate } from "./format";

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
          priceMicros: scaled(d.markPrice, 6),
          effectiveDate: d.markDate,
          shareClass: d.markClass,
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
}) {
  const context = holding.purchaseContext;
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(
    context?.receipt ?? null,
  );
  const [coversPosition, setCoversPosition] = useState(
    receipt?.details.coversPosition ?? false,
  );
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noticeIndex, setNoticeIndex] = useState<number | null>(null);
  const [noticeText, setNoticeText] = useState("");
  const [noticeWarnings, setNoticeWarnings] = useState<string[]>([]);
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
  const money = (n: number) => formatCurrency(n, context.currency);
  const update = (index: number, key: string, value: string) =>
    setDrafts((old) =>
      old.map((d, i) => (i === index ? { ...d, [key]: value } : d)),
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
      aria-label="Purchase details"
    >
      <div className="position-economics__heading">
        <div>
          <h3>Purchase details</h3>
          {(open || !receipt?.details.lots.length) && (
            <p>
              Optional. Record the underlying shares attributable to this SPV
              investment.
            </p>
          )}
        </div>
        {!open && (
          <ActionGroup wrap mobileLayout="stack">
            <Button
              tone={receipt?.details.lots.length ? "quiet" : "secondary"}
              onClick={() => {
                setCoversPosition(receipt?.details.coversPosition ?? false);
                setDrafts(
                  receipt?.details.lots.length
                    ? receipt.details.lots.map(draftFor)
                    : [blank(true)],
                );
                setError(null);
                setNoticeIndex(null);
                setNoticeWarnings([]);
                setOpen(true);
              }}
            >
              {receipt?.details.lots.length
                ? "Edit purchases"
                : "Add purchase details"}
            </Button>
            {!receipt?.details.lots.length && (
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
          {receipt.details.lots.map((lot, i) => {
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
                {(lot.priceMicros !== null || allIn !== null) && (
                  <StatGroup className="holding-performance__values purchase-summary__prices">
                    {lot.priceMicros !== null && (
                      <Stat
                        label="Purchase price / share"
                        value={`$${unitPrice(lot.priceMicros)}`}
                      />
                    )}
                    {allIn !== null && Number.isSafeInteger(allIn) && (
                      <Stat
                        label="All-in price / share"
                        value={`$${unitPrice(allIn)}`}
                      />
                    )}
                  </StatGroup>
                )}
                <dl className="purchase-summary__terms">
                  {lot.feePpm !== null && (
                    <div>
                      <dt>{lot.feeLabel ?? "One-time fee"}</dt>
                      <dd>
                        {decimal(lot.feePpm, 4)}%{" "}
                        {lot.feeBasis === "net_capital"
                          ? "added to share capital"
                          : lot.feeBasis === "gross_cash"
                            ? "of gross cash"
                            : "· basis unknown; excluded from calculations"}
                      </dd>
                    </div>
                  )}
                  {lot.referencePriceMicros !== null && (
                    <div>
                      <dt>{lot.referenceRound ?? "Entry"} reference price</dt>
                      <dd>${unitPrice(lot.referencePriceMicros)} / share</dd>
                    </div>
                  )}
                  {lot.referenceRound && lot.referencePriceMicros === null && (
                    <div>
                      <dt>Reference round</dt>
                      <dd>{lot.referenceRound}</dd>
                    </div>
                  )}
                  {lot.priceMicros !== null &&
                    lot.referencePriceMicros !== null && (
                      <div>
                        <dt>Purchase premium</dt>
                        <dd>
                          {percent(
                            ((BigInt(lot.priceMicros) -
                              BigInt(lot.referencePriceMicros)) *
                              1_000_000n) /
                              BigInt(lot.referencePriceMicros),
                          )}
                          % before fees
                        </dd>
                      </div>
                    )}
                  {((allIn !== null && lot.referencePriceMicros !== null) ||
                    lot.reportedPremiumPpm != null) && (
                    <div>
                      <dt>All-in premium</dt>
                      <dd>
                        {allIn !== null &&
                          lot.referencePriceMicros !== null && (
                            <span>
                              {percent(
                                ((BigInt(allIn) -
                                  BigInt(lot.referencePriceMicros)) *
                                  1_000_000n) /
                                  BigInt(lot.referencePriceMicros),
                              )}
                              % calculated
                            </span>
                          )}
                        {lot.reportedPremiumPpm != null && (
                          <span>
                            {percent(BigInt(lot.reportedPremiumPpm))}% quoted
                          </span>
                        )}
                      </dd>
                    </div>
                  )}
                  {(lot.reportedManagementFeePpm != null ||
                    lot.reportedCarryPpm != null) && (
                    <div>
                      <dt>Reported fees</dt>
                      <dd>
                        {lot.reportedManagementFeePpm != null && (
                          <span>
                            {decimal(lot.reportedManagementFeePpm, 4)}% annual
                            management
                          </span>
                        )}
                        {lot.reportedCarryPpm != null && (
                          <span>{decimal(lot.reportedCarryPpm, 4)}% carry</span>
                        )}
                        <small>
                          Separate from accepted fee and carry terms.
                        </small>
                      </dd>
                    </div>
                  )}
                </dl>
                {(shares ||
                  capital.grossCashMinor !== null ||
                  capital.netCapitalMinor !== null) && (
                  <dl className="purchase-summary__terms purchase-summary__capital">
                    {shares && (
                      <div>
                        <dt>
                          {shares.derived
                            ? "Calculated original shares"
                            : "Remaining underlying shares"}
                        </dt>
                        <dd>{decimal(shares.quantityMicros, 6)}</dd>
                      </div>
                    )}
                    {capital.grossCashMinor !== null && (
                      <div>
                        <dt>Cash contributed</dt>
                        <dd>{money(capital.grossCashMinor)}</dd>
                      </div>
                    )}
                    {capital.netCapitalMinor !== null && (
                      <div>
                        <dt>Share capital</dt>
                        <dd>{money(capital.netCapitalMinor)}</dd>
                      </div>
                    )}
                  </dl>
                )}
                {lot.mark && (
                  <dl className="purchase-summary__terms">
                    <div>
                      <dt>Valuation price</dt>
                      <dd>
                        ${unitPrice(lot.mark.priceMicros)} / share
                        <small>
                          {lot.mark.shareClass} ·{" "}
                          {formatDate(lot.mark.effectiveDate)} ·{" "}
                          {lot.mark.sourceLabel}
                        </small>
                      </dd>
                    </div>
                  </dl>
                )}
                {lot.sourceText && (
                  <Collapsible>
                    <CollapsibleTrigger>
                      <DisclosureIndicator />
                      Source notice
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="purchase-notice-text">{lot.sourceText}</p>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            );
          })}
          {estimate ? (
            <>
              <StatGroup className="holding-performance__values">
                <Stat
                  label="Share price estimate · before carry"
                  value={money(estimate.valueMinor)}
                  detail={`As of ${estimate.effectiveDate}${estimate.derivedShares ? " · uses calculated original shares" : ""}`}
                />
              </StatGroup>
              <p>
                {estimate.lots
                  .map(
                    (row) =>
                      `${decimal(row.quantityMicros, 6)} shares × $${unitPrice(row.priceMicros)}`,
                  )
                  .join(" + ")}
                . Excludes carry and remaining expenses; the provider mark stays
                separate.
              </p>
              {estimate.grossCashMinor !== null &&
                estimate.grossCashMinor > 0 &&
                holding.realizedValueMinor != null && (
                  <p>
                    Estimated return on cash contributed, before carry:{" "}
                    {percent(
                      ((BigInt(estimate.valueMinor) +
                        BigInt(holding.realizedValueMinor ?? 0) -
                        BigInt(estimate.grossCashMinor)) *
                        1_000_000n) /
                        BigInt(estimate.grossCashMinor),
                    )}
                    %. Includes reported distributions and the recorded upfront
                    fees; not tax basis.
                  </p>
                )}
            </>
          ) : (
            receipt.details.lots.length > 0 && (
              <p>
                To estimate value, add remaining shares and a dated price for
                the same share class covering the whole position.
              </p>
            )
          )}
        </>
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
            if (parsed.success && changed && !busy) void save();
          }}
        >
          <p>
            Known dates, source labels and reviewed capital are prefilled.
            Unknown amounts stay blank. Share counts here are company shares,
            not SPV units.
          </p>
          {noticeWarnings.length > 0 && (
            <Notice>{noticeWarnings.join(" ")}</Notice>
          )}
          {drafts.map((d, i) => (
            <fieldset key={d.id} className="purchase-fields">
              <legend>Purchase {i + 1}</legend>
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
                      <SelectItem value="unknown">Not specified</SelectItem>
                      <SelectItem value="primary">Primary</SelectItem>
                      <SelectItem value="secondary">Secondary</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {date(i, "purchasedOn", "Purchase date")}
                {field(i, "shareClass", "Underlying share class")}
                {field(i, "priceMicros", "Purchase price / share · USD", true)}
                {field(i, "feePpm", "One-time fee · %", true)}
                <Field label="Fee basis" variant="filled">
                  <Select
                    items={feeChoices}
                    value={d.feeBasis || "unknown"}
                    onValueChange={(v) =>
                      update(i, "feeBasis", v === "unknown" ? "" : String(v))
                    }
                  >
                    <SelectTrigger aria-label="Fee basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {feeChoices.map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
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
                {field(i, "reportedCarryPpm", "Reported carry · %", true)}
                {field(
                  i,
                  "remainingSharesMicros",
                  "Remaining underlying shares",
                  true,
                )}
                {date(i, "sharesAsOf", "Shares as of")}
                {field(i, "sourceLabel", "Purchase source")}
              </div>
              <p>
                Annual management fee and carry are reported purchase terms.
                Review fee &amp; carry separately to use them in investment
                economics.
              </p>
              {d.sourceText && (
                <Collapsible>
                  <CollapsibleTrigger>
                    <DisclosureIndicator />
                    Original purchase notice
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="purchase-notice-text">{d.sourceText}</p>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <Collapsible>
                <CollapsibleTrigger>
                  <DisclosureIndicator />
                  Capital and share calculation
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
                    No sales, splits or conversions; original shares are still
                    held.
                  </label>
                  <p>
                    Without a remaining share count, Keel can calculate original
                    shares from share capital and purchase price. Only use that
                    calculation if there have been no sales, splits or
                    conversions. These details do not replace fee and carry
                    terms.
                  </p>
                </CollapsibleContent>
              </Collapsible>
              <Collapsible>
                <CollapsibleTrigger>
                  <DisclosureIndicator />
                  Valuation price evidence
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
                    Use a price for the same underlying share class. A company
                    valuation or another preferred series is not a matching
                    share price.
                  </p>
                </CollapsibleContent>
              </Collapsible>
              <Button
                tone="secondary"
                onClick={() =>
                  setDrafts((old) => old.filter((_, j) => j !== i))
                }
              >
                Remove purchase {i + 1}
              </Button>
            </fieldset>
          ))}
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
          {!parsed.success && (
            <Notice tone="error">{parsed.error.issues[0]?.message}</Notice>
          )}
          <ActionGroup wrap mobileLayout="stack">
            {drafts.length < 20 && (
              <Button
                tone="secondary"
                onClick={() => setDrafts((old) => [...old, blank(false)])}
              >
                Add another purchase
              </Button>
            )}
            <Button
              tone="primary"
              type="submit"
              disabled={!parsed.success || !changed || busy}
            >
              {busy ? "Saving…" : "Save purchase details"}
            </Button>
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </ActionGroup>
        </form>
      )}
    </section>
  );
}
