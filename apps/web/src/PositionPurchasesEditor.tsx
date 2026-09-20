import { useState } from "react";
import type { Holding } from "@keel/domain";
import {
  AcceptPurchasesSchema,
  PurchaseReceiptSchema,
  estimatePurchaseValue,
  purchaseCapital,
  purchaseShares,
  type PurchaseLot,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatGroup,
} from "@keel/ui";
import { formatCurrency } from "./format";

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
    purchasedOn: lot.purchasedOn ?? "",
    shareClass: lot.shareClass ?? "",
    priceMicros: decimal(lot.priceMicros, 6),
    referencePriceMicros: decimal(lot.referencePriceMicros, 6),
    grossCashMinor: decimal(lot.grossCashMinor, 2),
    netCapitalMinor: decimal(lot.netCapitalMinor, 2),
    feePpm: decimal(lot.feePpm, 4),
    feeBasis: lot.feeBasis ?? "",
    feeLabel: lot.feeLabel ?? "",
    remainingSharesMicros: decimal(lot.remainingSharesMicros, 6),
    sharesAsOf: lot.sharesAsOf ?? "",
    sourceLabel: lot.sourceLabel ?? "",
    sourceUrl: lot.sourceUrl ?? "",
    markPrice: decimal(lot.mark?.priceMicros, 6),
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
  holding: Holding;
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
  const [reviewing, setReviewing] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const preview = parsed.success
    ? PurchaseReceiptSchema.parse({
        id: "preview",
        positionId: holding.id,
        snapshotId: context.snapshotId,
        currency: context.currency,
        details: parsed.data.details,
        acceptedAt: new Date().toISOString(),
      })
    : null;
  const shown = reviewing ? preview : receipt;
  const estimate = estimatePurchaseValue(shown, context.snapshotId);
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
      setReviewing(false);
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
          <p>
            Optional. Record the underlying shares attributable to this SPV
            investment.
          </p>
        </div>
        {!open && (
          <Button
            tone="secondary"
            onClick={() => {
              setCoversPosition(receipt?.details.coversPosition ?? false);
              setDrafts(
                receipt?.details.lots.length
                  ? receipt.details.lots.map(draftFor)
                  : [blank(true)],
              );
              setReviewing(false);
              setError(null);
              setOpen(true);
            }}
          >
            {receipt?.details.lots.length
              ? "Edit purchases"
              : "Add purchase details"}
          </Button>
        )}
      </div>
      {receipt && receipt.snapshotId !== context.snapshotId && (
        <Notice tone="error">
          The source position changed. Review the remaining shares before using
          a share price estimate.
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {(!open || reviewing) && shown && (
        <>
          {shown.details.lots.map((lot, i) => {
            const shares = purchaseShares(lot);
            const capital = purchaseCapital(lot);
            const allIn =
              lot.priceMicros !== null &&
              capital.grossCashMinor !== null &&
              capital.netCapitalMinor !== null &&
              capital.netCapitalMinor > 0
                ? Number(
                    (BigInt(lot.priceMicros) * BigInt(capital.grossCashMinor) +
                      BigInt(capital.netCapitalMinor) / 2n) /
                      BigInt(capital.netCapitalMinor),
                  )
                : null;
            return (
              <div key={lot.id} className="purchase-summary">
                <h4>
                  Purchase {i + 1}
                  {lot.shareClass ? ` · ${lot.shareClass}` : ""}
                </h4>
                <StatGroup className="holding-performance__values">
                  <Stat
                    label="Purchase price / share"
                    value={
                      lot.priceMicros === null
                        ? "Not set"
                        : `$${decimal(lot.priceMicros, 6)}`
                    }
                  />
                  <Stat
                    label={
                      shares?.derived
                        ? "Calculated original shares"
                        : "Remaining underlying shares"
                    }
                    value={
                      shares ? decimal(shares.quantityMicros, 6) : "Not set"
                    }
                  />
                  <Stat
                    label="Cash contributed"
                    value={
                      capital.grossCashMinor === null
                        ? "Not set"
                        : money(capital.grossCashMinor)
                    }
                  />
                  <Stat
                    label="Share capital"
                    value={
                      capital.netCapitalMinor === null
                        ? "Not set"
                        : money(capital.netCapitalMinor)
                    }
                  />
                </StatGroup>
                <p>
                  {lot.sourceLabel ?? "Source not recorded"}
                  {lot.purchasedOn ? ` · Purchased ${lot.purchasedOn}` : ""}
                </p>
                {lot.feePpm !== null && (
                  <p>
                    One-time {lot.feeLabel ?? "fee"}: {decimal(lot.feePpm, 4)}%{" "}
                    {lot.feeBasis === "net_capital"
                      ? "added to share capital"
                      : "of gross cash"}
                    .
                  </p>
                )}
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
                      % relative to ${decimal(lot.referencePriceMicros, 6)} per
                      share.
                    </p>
                  )}
                {allIn !== null && Number.isSafeInteger(allIn) && (
                  <p>
                    All-in purchase price: ${decimal(allIn, 6)} per share,
                    including recorded upfront fees.
                  </p>
                )}
                {lot.mark && (
                  <p>
                    Valuation price: ${decimal(lot.mark.priceMicros, 6)} ·{" "}
                    {lot.mark.shareClass} · {lot.mark.effectiveDate} ·{" "}
                    {lot.mark.sourceLabel}.
                  </p>
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
                      `${decimal(row.quantityMicros, 6)} shares × $${decimal(row.priceMicros, 6)}`,
                  )
                  .join(" + ")}
                . Excludes carry and remaining expenses; the provider mark stays
                separate.
              </p>
              {estimate.grossCashMinor !== null &&
                estimate.grossCashMinor > 0 && (
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
            shown.details.lots.length > 0 && (
              <p>
                A share price estimate needs attributable shares, a matching
                share class, and dated valuation evidence for every purchase.
                Confirm that the purchases cover the whole position to use the
                estimate. Partial details remain saved.
              </p>
            )
          )}
        </>
      )}
      {open && !reviewing && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (parsed.success && changed) setReviewing(true);
          }}
        >
          <p>
            Known dates, source labels and reviewed capital are prefilled.
            Unknown amounts stay blank. Share counts here are company shares,
            not SPV units.
          </p>
          {drafts.map((d, i) => (
            <fieldset key={d.id} className="purchase-fields">
              <legend>Purchase {i + 1}</legend>
              <div className="position-economics__fields">
                {date(i, "purchasedOn", "Purchase date")}
                {field(i, "shareClass", "Underlying share class")}
                {field(i, "priceMicros", "Purchase price / share · USD", true)}
                {field(
                  i,
                  "remainingSharesMicros",
                  "Remaining underlying shares",
                  true,
                )}
                {date(i, "sharesAsOf", "Shares as of")}
                {field(i, "sourceLabel", "Purchase source")}
              </div>
              <Collapsible>
                <CollapsibleTrigger>
                  <DisclosureIndicator />
                  Capital, one-time fee and reference price
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
            <Button type="submit" disabled={!parsed.success || !changed}>
              Review purchase details
            </Button>
            <Button tone="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </ActionGroup>
        </form>
      )}
      {open && reviewing && (
        <ActionGroup wrap mobileLayout="stack">
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save purchase details"}
          </Button>
          <Button
            tone="secondary"
            disabled={busy}
            onClick={() => setReviewing(false)}
          >
            Back to edit
          </Button>
        </ActionGroup>
      )}
    </section>
  );
}
