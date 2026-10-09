import { useEffect, useRef, useState } from "react";
import type { Holding } from "@keel/domain";
import {
  AcceptPurchasesSchema,
  PositionValuationEvidenceSchema,
  PurchaseLotSchema,
  PurchaseReceiptSchema,
  estimatePurchaseValue,
  purchaseCapital,
  purchaseShares,
  type PurchaseLot,
} from "@keel/domain/position-purchases";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataList,
  DataItem,
  DatePicker,
  DisclosureIndicator,
  Field,
  Input,
  Notice,
  Stat,
  TextLink,
} from "@keel/ui";
import { decimal, scaled } from "./decimal-input";
import { formatPositionCurrency as formatCurrency, formatDate } from "./format";

type Draft = {
  lot: PurchaseLot;
  markPrice: string;
  markDate: string;
  markClass: string;
  markSource: string;
  markUrl: string;
};

function draftFor(lot: PurchaseLot): Draft {
  return {
    lot,
    markPrice: decimal(lot.mark?.priceMicros, 6),
    markDate: lot.mark?.effectiveDate ?? "",
    markClass: lot.mark?.shareClass ?? "",
    markSource: lot.mark?.sourceLabel ?? "",
    markUrl: lot.mark?.sourceUrl ?? "",
  };
}

function priceSelection(draft: Draft) {
  return {
    mark: draft.lot.mark,
    markPrice: draft.markPrice,
    markDate: draft.markDate,
    markClass: draft.markClass,
    markSource: draft.markSource,
    markUrl: draft.markUrl,
  };
}

function lotFor(draft: Draft, confirmed: boolean) {
  return {
    ...draft.lot,
    originalSharesUnchanged:
      draft.lot.remainingSharesMicros === null && confirmed,
    mark:
      draft.markPrice || draft.markSource
        ? {
            ...draft.lot.mark,
            priceMicros: scaled(draft.markPrice, 6),
            effectiveDate: draft.markDate || null,
            shareClass: draft.markClass || null,
            sourceLabel: draft.markSource,
            sourceUrl: draft.markUrl || null,
          }
        : null,
  };
}

export function PositionShareValuationEditor({
  holding,
  enabled,
  onAccepted,
  onDirtyChange,
  onEditPurchase,
}: {
  holding: Holding;
  enabled: boolean;
  onAccepted: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  onEditPurchase?: ((index: number) => void) | undefined;
}) {
  const context = holding.purchaseContext!;
  const receipt = context.receipt;
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    if (receipt?.details.lots.length) return receipt.details.lots.map(draftFor);
    return [
      draftFor(
        PurchaseLotSchema.parse({
          id: crypto.randomUUID(),
          purchasedOn: context.openedOn ?? null,
          shareClass: null,
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: null,
          netCapitalMinor: null,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: null,
          sharesAsOf: null,
          sourceLabel: holding.sourceLabel,
          sourceUrl: null,
          mark: null,
        }),
      ),
    ];
  });
  const [initialDrafts, setInitialDrafts] = useState(drafts);
  const receiptId = useRef(receipt?.id);
  const receiptLots = useRef(receipt?.details.lots.length ?? 0);
  const appliedReceiptId = useRef<string | null>(null);
  const acceptedCoverage = Boolean(
    receipt?.snapshotId === context.snapshotId &&
    receipt?.details.coversPosition &&
    receipt.details.lots.every(
      (lot) =>
        lot.remainingSharesMicros !== null || lot.originalSharesUnchanged,
    ),
  );
  const [initiallyConfirmed, setInitiallyConfirmed] =
    useState(acceptedCoverage);
  const [confirmed, setConfirmed] = useState(initiallyConfirmed);
  const [evidence, setEvidence] = useState<ReturnType<
    typeof PositionValuationEvidenceSchema.parse
  > | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useRef<HTMLElement>(null);
  useEffect(() => {
    if (receiptId.current === receipt?.id) return;
    const accepted = receipt?.details.lots.map(draftFor) ?? [];
    const ownApply = receipt?.id === appliedReceiptId.current;
    // Only pending prices survive a purchase edit. Purchase facts always come
    // from the newly accepted receipt, and coverage needs fresh confirmation.
    const rebased = accepted.map((next) => {
      if (ownApply) return next;
      const pending =
        drafts.find((draft) => draft.lot.id === next.lot.id) ??
        (receiptLots.current === 0 && drafts.length === 1
          ? drafts[0]
          : undefined);
      const baseline = initialDrafts.find(
        (draft) => draft.lot.id === pending?.lot.id,
      );
      if (
        !pending ||
        !baseline ||
        JSON.stringify(priceSelection(pending)) ===
          JSON.stringify(priceSelection(baseline))
      )
        return next;
      if (
        !pending.lot.mark?.proxy &&
        next.lot.shareClass?.trim().toLowerCase() !==
          pending.markClass.trim().toLowerCase()
      )
        return next;
      return {
        ...next,
        markPrice: pending.markPrice,
        markDate: pending.markDate,
        markClass: pending.markClass,
        markSource: pending.markSource,
        markUrl: pending.markUrl,
        lot: { ...next.lot, mark: pending.lot.mark },
      };
    });
    receiptId.current = receipt?.id;
    receiptLots.current = accepted.length;
    appliedReceiptId.current = null;
    setInitialDrafts(accepted);
    setDrafts(rebased);
    setInitiallyConfirmed(acceptedCoverage);
    setConfirmed(ownApply && acceptedCoverage);
    setError(null);
  }, [receipt, acceptedCoverage, drafts, initialDrafts]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch(
      `/api/investment-positions/${encodeURIComponent(holding.id)}/share-price-evidence`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Price evidence could not be loaded.");
        const result = PositionValuationEvidenceSchema.parse(
          await response.json(),
        );
        if (!controller.signal.aborted) {
          setEvidenceError(null);
          setEvidence(result);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setEvidenceError(
            "Price evidence could not be loaded. Retry or enter a sourced price below.",
          );
      });
    return () => controller.abort();
  }, [enabled, holding.id, retry]);

  const dirty =
    JSON.stringify(drafts) !== JSON.stringify(initialDrafts) ||
    confirmed !== initiallyConfirmed;
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const inputFor = (coverage: boolean) =>
    AcceptPurchasesSchema.safeParse({
      expectedSnapshotId: context.snapshotId,
      expectedReceiptId: receipt?.id ?? null,
      expectedTermsId:
        holding.positionEconomicsContext?.acceptedTerms?.id ?? null,
      details: {
        ...receipt?.details,
        coversPosition: coverage,
        lots: drafts.map((draft) => lotFor(draft, coverage)),
      },
    });
  const parsed = inputFor(confirmed);
  const conditional = inputFor(true);
  const estimateFor = (input: typeof parsed) =>
    input.success
      ? estimatePurchaseValue(
          {
            id: "draft",
            positionId: holding.id,
            snapshotId: context.snapshotId,
            currency: context.currency,
            acceptedAt: new Date().toISOString(),
            details: input.data.details,
          },
          context.snapshotId,
        )
      : null;
  const estimate = estimateFor(conditional);
  const ready = estimateFor(parsed);
  const usesProxy = drafts.some((draft) => Boolean(draft.lot.mark?.proxy));
  const missingShares = drafts
    .map(({ lot }, index) => ({ lot, index }))
    .filter(
      ({ lot }) =>
        !purchaseShares({ ...lot, originalSharesUnchanged: true }) ||
        !lot.shareClass ||
        !lot.sourceLabel,
    );
  const money = (minor: number) => formatCurrency(minor, context.currency);
  const update = (
    index: number,
    key: Exclude<keyof Draft, "lot">,
    value: string,
  ) => {
    setConfirmed(false);
    setDrafts((old) =>
      old.map((draft, i) =>
        i === index
          ? {
              ...draft,
              [key]: value,
              ...(draft.lot.mark?.sourceEvidenceId
                ? { lot: { ...draft.lot, mark: null } }
                : {}),
            }
          : draft,
      ),
    );
  };
  const selectPrice = (
    item: NonNullable<typeof evidence>["prices"][number],
    proxy: boolean,
  ) => {
    setConfirmed(false);
    setDrafts((old) =>
      old.map((draft) => ({
        ...draft,
        lot: {
          ...draft.lot,
          mark: {
            priceMicros: item.markMicros!,
            effectiveDate: item.markDate,
            shareClass: item.shareClass,
            sourceLabel: `${item.sourceLabel} · ${item.positionLabel}`,
            sourceUrl: null,
            sourceEvidenceId: item.id,
            ...(proxy
              ? {
                  proxy: {
                    confirmed: true,
                    reason: "Closest available imported share price.",
                    capturedAt: item.capturedAt,
                  },
                }
              : { comparableConfirmed: true }),
          },
        },
        markPrice: decimal(item.markMicros, 6),
        markDate: item.markDate ?? "",
        markClass: item.shareClass ?? "",
        markSource: `${item.sourceLabel} · ${item.positionLabel}`,
        markUrl: "",
      })),
    );
    requestAnimationFrame(() =>
      preview.current?.focus({ preventScroll: true }),
    );
  };
  const field = (
    index: number,
    key: Exclude<keyof Draft, "lot">,
    label: string,
    numeric = false,
  ) => (
    <Field label={label} variant="filled">
      <Input
        aria-label={label}
        value={drafts[index]?.[key] ?? ""}
        inputMode={numeric ? "decimal" : "text"}
        onChange={(event) => update(index, key, event.currentTarget.value)}
      />
    </Field>
  );
  const date = (index: number, key: "markDate", label: string) => (
    <Field label={label} variant="filled">
      <DatePicker
        aria-label={label}
        value={drafts[index]?.[key] ?? ""}
        onValueChange={(value) => update(index, key, value)}
      />
    </Field>
  );
  const reset = () => {
    setDrafts(initialDrafts);
    setConfirmed(initiallyConfirmed);
    setError(null);
  };
  const save = async () => {
    if (
      !parsed.success ||
      !ready ||
      !dirty ||
      busy ||
      receiptId.current !== receipt?.id
    )
      return;
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
            : "The estimate could not be applied.",
        );
      appliedReceiptId.current = PurchaseReceiptSchema.parse(body).id;
      await onAccepted();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The estimate could not be applied.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Share-based valuation" className="share-valuation">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="holding-detail-help">
          Choose a price to estimate your remaining position. A proxy can use a
          different share class; it stays labeled as an estimate.
        </p>
        <section
          aria-label="Available share prices"
          className="share-valuation__prices"
        >
          <h3>Available share prices</h3>
          {!evidence && !evidenceError && (
            <p role="status">Loading share prices…</p>
          )}
          {evidenceError && (
            <Notice tone="error">
              {evidenceError}
              <Button tone="quiet" onClick={() => setRetry((old) => old + 1)}>
                Retry
              </Button>
            </Notice>
          )}
          {evidence &&
            !evidence.prices.some((item) => item.markMicros !== null) && (
              <p>No imported share price yet. Enter a sourced price below.</p>
            )}
          {evidence?.prices
            .filter((item) => item.markMicros !== null)
            .map((item) => {
              const matching = Boolean(
                item.markDate &&
                item.shareClass &&
                drafts.every(
                  (draft) =>
                    draft.lot.shareClass?.trim().toLowerCase() ===
                    item.shareClass!.trim().toLowerCase(),
                ),
              );
              return (
                <div className="share-valuation__price" key={item.id}>
                  <div>
                    <strong>{item.sourceLabel}</strong>
                    <p>
                      {`$${decimal(item.markMicros, 6)} / share`}
                      {item.shareClass ? ` · ${item.shareClass}` : ""}
                    </p>
                    <small>
                      {item.positionLabel}
                      {item.markDate ? ` · ${formatDate(item.markDate)}` : ""} ·
                      Captured {formatDate(item.capturedAt.slice(0, 10))}
                    </small>
                  </div>
                  <ActionGroup wrap mobileLayout="stack">
                    {matching && (
                      <Button
                        tone="secondary"
                        onClick={() => selectPrice(item, false)}
                      >
                        Use matching price
                      </Button>
                    )}
                    <Button
                      tone="secondary"
                      onClick={() => selectPrice(item, true)}
                    >
                      Use as proxy estimate
                    </Button>
                  </ActionGroup>
                </div>
              );
            })}
          {drafts.length > 1 && (
            <p className="holding-detail-help">
              Selecting a price applies it to all {drafts.length} purchases
              below. You can also set a price for each purchase.
            </p>
          )}
        </section>
        <section
          ref={preview}
          tabIndex={-1}
          aria-label={
            usesProxy ? "Proxy estimate preview" : "Share estimate preview"
          }
          className="investment-calculation purchase-proxy-confirmation share-valuation__preview"
        >
          {estimate && (
            <Stat
              label={
                usesProxy
                  ? "Estimated value · proxy"
                  : "Estimated value · shares"
              }
              value={money(estimate.valueMinor)}
              detail="Before carry and remaining expenses"
            />
          )}
          {estimate ? (
            <p>
              Remaining shares × selected prices.{" "}
              {dirty
                ? "Confirm below, then apply to update your position summary."
                : "Saved estimate for this position."}
            </p>
          ) : (
            <p>
              {missingShares.length
                ? "Add dated remaining shares, or confirm net capital and purchase price, in Purchases."
                : "Choose a price above or enter a sourced price below."}
            </p>
          )}
          {holding.positionValueContext?.acceptedAdjustment && (
            <p>
              Your reviewed value from{" "}
              {holding.positionValueContext.acceptedAdjustment.sourceLabel}{" "}
              stays primary. This estimate is saved alongside it.
            </p>
          )}
          {usesProxy && (
            <p className="holding-detail-help">
              Proxy prices may represent another share class. Provider marks
              stay separate.
            </p>
          )}
          {drafts[0]?.lot.mark && (
            <p className="holding-detail-help">
              {drafts[0].markSource} · ${drafts[0].markPrice} / share
              {drafts[0].markClass ? ` · ${drafts[0].markClass}` : ""}
            </p>
          )}
        </section>
        {missingShares.length > 0 && onEditPurchase && (
          <ActionGroup wrap mobileLayout="stack">
            {missingShares.map(({ index, lot }) => (
              <Button
                key={lot.id}
                tone="quiet"
                onClick={() => onEditPurchase(index)}
                aria-label={
                  drafts.length === 1
                    ? "Add share details"
                    : `Add share details for purchase ${index + 1}`
                }
              >
                {drafts.length === 1
                  ? "Add share details"
                  : `Purchase ${index + 1} · Add share details`}
              </Button>
            ))}
          </ActionGroup>
        )}
        {drafts.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger layout="inline">
              Share details <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {drafts.map(({ lot }, index) => {
                const shares = purchaseShares({
                  ...lot,
                  originalSharesUnchanged: true,
                });
                const capital = purchaseCapital(lot);
                return (
                  <div key={lot.id} className="share-valuation__share-details">
                    {drafts.length > 1 && (
                      <h4>
                        Purchase {index + 1}
                        {lot.purchasedOn
                          ? ` · ${formatDate(lot.purchasedOn)}`
                          : ""}
                      </h4>
                    )}
                    <DataList>
                      {shares && (
                        <DataItem
                          label={
                            shares.derived
                              ? "Calculated shares"
                              : "Remaining shares"
                          }
                          value={decimal(shares.quantityMicros, 6)}
                        />
                      )}
                      {lot.sharesAsOf && (
                        <DataItem
                          label="Shares as of"
                          value={formatDate(lot.sharesAsOf)}
                        />
                      )}
                      {shares?.derived && (
                        <DataItem
                          label="Calculation"
                          value={`${money(capital.netCapitalMinor!)} ÷ $${decimal(lot.priceMicros, 6)}/share`}
                        />
                      )}
                      {lot.shareClass && (
                        <DataItem label="Share class" value={lot.shareClass} />
                      )}
                    </DataList>
                    {onEditPurchase && (
                      <Button
                        tone="quiet"
                        onClick={() => onEditPurchase(index)}
                        aria-label={`Edit share details for purchase ${index + 1}`}
                      >
                        Edit share details
                      </Button>
                    )}
                  </div>
                );
              })}
            </CollapsibleContent>
          </Collapsible>
        )}
        <Collapsible>
          <CollapsibleTrigger layout="inline">
            {drafts.length > 1
              ? "Set prices per purchase"
              : drafts[0]?.markPrice
                ? "Enter a different price"
                : "Enter a sourced price"}{" "}
            <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent keepMounted>
            {drafts.map((draft, index) => (
              <fieldset key={draft.lot.id} className="share-valuation__lot">
                {drafts.length > 1 && (
                  <legend>
                    Purchase {index + 1}
                    {draft.lot.purchasedOn
                      ? ` · ${formatDate(draft.lot.purchasedOn)}`
                      : ""}
                  </legend>
                )}
                <div className="position-economics__fields">
                  {field(
                    index,
                    "markPrice",
                    "Valuation price / share · $",
                    true,
                  )}
                  {date(index, "markDate", "Valuation price as of")}
                  {field(index, "markClass", "Valuation share class")}
                  {field(index, "markSource", "Valuation source")}
                  {field(index, "markUrl", "Valuation source link")}
                </div>
              </fieldset>
            ))}
            <p className="holding-detail-help">
              A manually entered price needs a date, source and matching share
              class. To use another share class, choose an imported proxy above.
            </p>
          </CollapsibleContent>
        </Collapsible>
        {evidence?.watch.length ? (
          <Collapsible>
            <CollapsibleTrigger layout="inline">
              Portfolio Watch context <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {evidence.watch.map((item) => (
                <p key={item.id}>
                  <TextLink href={item.url} target="_blank" rel="noreferrer">
                    {item.title}
                  </TextLink>{" "}
                  · {formatDate(item.publishedAt.slice(0, 10))}
                  <br />
                  {item.fact}
                </p>
              ))}
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <label className="purchase-coverage">
          <Input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
          />
          These purchases cover all my remaining shares. Any shares calculated
          from net capital are still held, with no sales, splits or conversions.
        </label>
        {!parsed.success && dirty && (
          <Notice tone="error">{parsed.error.issues[0]?.message}</Notice>
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <ActionGroup align="end" wrap mobileLayout="stack">
          <Button tone="quiet" disabled={busy || !dirty} onClick={reset}>
            Reset
          </Button>
          <Button
            tone="primary"
            type="submit"
            disabled={busy || !dirty || !ready}
          >
            {busy ? "Applying…" : "Apply estimate"}
          </Button>
        </ActionGroup>
      </form>
    </section>
  );
}
