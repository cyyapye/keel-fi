import { useEffect, useState } from "react";
import { gpRecord } from "./holding-value";
import type { Holding } from "@keel/domain";
import {
  AcceptValuationSchema,
  continuedPriceMetadata,
  type ValuationRecord,
} from "@keel/domain/valuation-record";
import {
  assessValuationFromShares,
  PositionValuationEvidenceSchema,
  PurchaseReceiptSchema,
  type PurchaseReceipt,
} from "@keel/domain/position-purchases";
import {
  ActionGroup,
  Button,
  ChoiceGroup,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Notice,
  Spinner,
  TextLink,
} from "@keel/ui";
import {
  HoldingDate,
  HoldingInput,
  HoldingSelect,
  HoldingShareBasis,
} from "./HoldingFields";
import { decimal, scaled } from "./decimal-input";
import { formatDate, formatMoney, formatSharePrice } from "./format";

type Evidence = ReturnType<typeof PositionValuationEvidenceSchema.parse>;
type Draft = {
  record: ValuationRecord;
  total: string;
  price: string;
  date: string;
  priceDate: string;
  classification: ValuationRecord["carryStatus"];
  shareClass: string;
  label: string;
  url: string;
  watch: string;
  method: "total" | "shares";
  basis: string;
  crossClass: string;
};
function draftFor(
  record: ValuationRecord,
  method: "total" | "shares" = "total",
): Draft {
  return {
    record,
    basis: record.shareBasis ? String(record.shareBasis.unitsPerOriginal) : "",
    crossClass: record.crossClassProxy ? "accepted" : "",
    total: decimal(record.totalMinor, 2),
    price: decimal(record.priceMicros, 6),
    date: record.effectiveDate,
    priceDate:
      record.priceDate ??
      (record.priceMicros === null ? record.effectiveDate : ""),
    classification: record.carryStatus,
    shareClass: record.shareClass ?? "",
    label: record.sourceLabel,
    url: record.sourceUrl ?? "",
    watch: record.watchEvidenceId ?? "",
    method: record.totalMinor === null ? "shares" : method,
  };
}
export function HoldingValuationEditor({
  holding,
  onAccepted,
  onClose,
}: {
  holding: Holding;
  onAccepted: () => Promise<void>;
  onClose: () => void;
}) {
  const context = holding.purchaseContext!;
  const receipt = context.receipt;
  const saved = receipt?.details.valuation;
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [source, setSource] = useState(
    saved?.selected?.recordId ?? (holding.manualContext ? "mine" : "gp"),
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [reloadingSources, setReloadingSources] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/investment-positions/${encodeURIComponent(holding.id)}/share-price-evidence`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const body = PositionValuationEvidenceSchema.parse(
          await response.json(),
        );
        if (!controller.signal.aborted) {
          setEvidence(body);
          setLoadError(false);
          if (reload > 0) {
            setReloadingSources(false);
            setStale(false);
            setError(null);
          }
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadError(true);
          setReloadingSources(false);
        }
      });
    return () => controller.abort();
  }, [holding.id, reload]);
  const records: ValuationRecord[] = [...(saved?.records ?? [])];
  if (!records.some((r) => r.id === "gp"))
    records.unshift(gpRecord(holding, evidence));
  if (!records.some((r) => r.id === "mine"))
    records.push({
      id: "mine",
      origin: "judgment",
      totalMinor: null,
      priceMicros: null,
      priceDate: null,
      effectiveDate: holding.manualContext
        ? ""
        : new Date().toISOString().slice(0, 10),
      shareClass: receipt?.details.lots[0]?.shareClass ?? null,
      carryStatus: holding.manualContext ? "unknown" : "before_carry",
      sourceLabel: holding.manualContext ? "Your estimate" : "My estimate",
      sourceUrl: null,
      sourceEvidenceId: null,
      sourcePositionId: null,
      sourceCapturedAt: null,
      watchEvidenceId: null,
    });
  for (const price of evidence?.prices ?? []) {
    if (price.positionId === holding.id || price.markMicros === null) continue;
    const id = `proxy:${price.positionId}`;
    const previous = saved?.records.find((r) => r.id === id);
    const record: ValuationRecord = {
      id,
      origin: "proxy",
      followSource: true,
      priceSourcePositionId: price.priceSourcePositionId ?? price.positionId,
      shareBasis: price.shareBasis ?? null,
      crossClassProxy: previous?.crossClassProxy ?? false,
      totalMinor: null,
      priceMicros: price.markMicros,
      effectiveDate: price.markDate ?? price.observedAt.slice(0, 10),
      priceDate: price.markDate,
      shareClass: price.shareClass,
      carryStatus: "before_carry",
      sourceLabel: price.sourceLabel,
      sourceUrl: null,
      sourceEvidenceId: price.id,
      sourcePositionId: price.positionId,
      sourceCapturedAt: price.capturedAt,
      watchEvidenceId: null,
    };
    record.sourceContinuation = continuedPriceMetadata(previous, record);
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) records.push(record);
    else records[index] = record;
  }
  const record = records.find((r) => r.id === source) ?? records[0]!;
  const baseline = draftFor(
    record,
    saved?.selected?.recordId === source ? saved.selected.method : "total",
  );
  const draft = drafts[source] ?? baseline;
  const update = (key: Exclude<keyof Draft, "record">, value: string) => {
    setError(null);
    setDrafts((old) => ({
      ...old,
      [source]: {
        ...draft,
        [key]: value,

        ...(key === "total"
          ? { method: value.trim() ? "total" : "shares" }
          : {}),
      },
    }));
  };
  const price = scaled(draft.price, 6),
    total = scaled(draft.total, 2);
  const changedEvidence =
    draft.price !== decimal(draft.record.priceMicros, 6) ||
    (draft.priceDate || null) !== draft.record.priceDate ||
    draft.shareClass !== (draft.record.shareClass ?? "") ||
    draft.basis !==
      (draft.record.shareBasis
        ? String(draft.record.shareBasis.unitsPerOriginal)
        : "");
  const candidate = {
    ...draft.record,
    ...(draft.basis.trim() || draft.record.shareBasis !== undefined
      ? {
          shareBasis: draft.basis.trim()
            ? {
                key: draft.record.shareBasis?.key ?? "issuer-original",
                unitsPerOriginal: scaled(draft.basis, 0),
              }
            : null,
        }
      : {}),
    ...(record.origin === "proxy"
      ? { crossClassProxy: draft.crossClass === "accepted" }
      : {}),
    ...(changedEvidence && draft.record.sourcePositionId
      ? {
          priceSourcePositionId:
            draft.record.priceSourcePositionId ?? draft.record.sourcePositionId,
        }
      : {}),
    totalMinor: total,
    priceMicros: price,
    effectiveDate: draft.date,
    priceDate: price === null ? null : draft.priceDate || null,
    shareClass: draft.shareClass || null,
    carryStatus: draft.classification,
    sourceLabel: draft.label,
    sourceUrl: draft.url || null,
    watchEvidenceId: draft.watch || null,
    ...(changedEvidence && record.origin !== "proxy"
      ? {
          sourceEvidenceId: null,
          sourcePositionId: null,
          sourceCapturedAt: null,
        }
      : {}),
  };
  const latestPrice = evidence?.prices.find((p) =>
    record.origin === "proxy"
      ? p.positionId === record.sourcePositionId
      : p.positionId ===
        (record.priceSourcePositionId ??
          holding.linkedReportedValue?.sourcePositionId ??
          holding.id),
  );
  const updatedPrice =
    latestPrice &&
    latestPrice.markMicros !== null &&
    (latestPrice.id !== draft.record.sourceEvidenceId ||
      latestPrice.capturedAt !== draft.record.sourceCapturedAt)
      ? latestPrice
      : null;
  const adoptUpdatedPrice = () => {
    if (!updatedPrice) return;
    const next = {
      ...draft.record,
      priceMicros: updatedPrice.markMicros,
      priceDate: updatedPrice.markDate,
      shareClass: updatedPrice.shareClass,
      shareBasis: updatedPrice.shareBasis ?? null,
      priceSourcePositionId:
        updatedPrice.priceSourcePositionId ?? updatedPrice.positionId,
      sourceEvidenceId: updatedPrice.id,
      sourcePositionId: updatedPrice.positionId,
      sourceCapturedAt: updatedPrice.capturedAt,
    };
    next.sourceContinuation = continuedPriceMetadata(draft.record, next);
    setDrafts((old) => ({
      ...old,
      [source]: {
        ...draft,
        record: next,
        price: decimal(next.priceMicros, 6),
        priceDate: next.priceDate ?? "",
        shareClass: next.shareClass ?? "",
        basis: next.shareBasis ? String(next.shareBasis.unitsPerOriginal) : "",
      },
    }));
    setError(null);
  };
  const parsed = AcceptValuationSchema.safeParse({
    expectedSnapshotId: context.snapshotId,
    expectedReceiptId: receipt?.id ?? null,
    expectedTermsId:
      holding.positionEconomicsContext?.acceptedTerms?.id ?? null,
    record: candidate,
    method: draft.method,
  });
  const validationError = parsed.success
    ? null
    : parsed.error.issues.find(({ path }) => path.at(-1) !== "unitsPerOriginal")
        ?.message;
  const details = receipt?.details ?? { coversPosition: false, lots: [] };
  const assessment = parsed.success
    ? assessValuationFromShares(details, parsed.data.record)
    : null;
  const calculation =
    (record.followSource ||
      (details.investmentSnapshotId ?? receipt?.snapshotId) ===
        context.snapshotId) &&
    assessment?.ok
      ? assessment.calculation
      : null;
  const crossClass = details.lots.some(
    (lot) =>
      lot.shareClass?.trim().toLowerCase() !==
      draft.shareClass.trim().toLowerCase(),
  );
  const comparable =
    draft.classification === "before_carry" && draft.date === draft.priceDate;
  const difference =
    total !== null && Number.isSafeInteger(total) && calculation
      ? BigInt(total) - BigInt(calculation.valueMinor)
      : null;
  const choices = difference !== null && (difference !== 0n || !comparable);
  const valid =
    parsed.success &&
    (draft.method === "total" ? total !== null : calculation !== null);
  const original = saved?.records.find((r) => r.id === source);
  const changed =
    !original ||
    JSON.stringify(candidate) !== JSON.stringify(original) ||
    saved?.selected?.recordId !== source ||
    saved.selected.method !== draft.method;
  const save = async () => {
    if (
      !valid ||
      !parsed.success ||
      busy ||
      !changed ||
      stale ||
      reloadingSources ||
      (record.origin === "proxy" && updatedPrice)
    )
      return;
    setBusy(true);
    setDrafts((old) => ({ ...old, [source]: draft }));
    setError(null);
    try {
      const response = await fetch(
        `/api/investment-positions/${encodeURIComponent(holding.id)}/valuation`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const body: unknown = await response.json();
      if (response.status === 409) setStale(true);
      if (!response.ok)
        throw new Error(
          typeof body === "object" && body && "error" in body
            ? String(body.error)
            : "Valuation could not be saved.",
        );
      PurchaseReceiptSchema.parse(body);
      await onAccepted();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Valuation could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const choiceAmount = (
    value: number,
    detail: string,
    classification: string,
  ) => (
    <>
      <strong className="holding-choice-amount">{formatMoney(value)}</strong>
      <small>{detail}</small>
      <small>{classification}</small>
    </>
  );
  return (
    <form
      className="holding-valuation-editor"
      aria-label="Edit valuation"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <fieldset className="holding-form-fieldset" disabled={busy}>
        <HoldingSelect
          label="Source"
          value={source}
          onChange={(value) => {
            setSource(value);
            setError(null);
          }}
          options={records.map((r) => ({
            value: r.id,
            label:
              r.origin === "judgment"
                ? "My estimate"
                : r.origin === "proxy"
                  ? `${r.sourceLabel} · Other SPV`
                  : r.sourceLabel,
          }))}
        />
        {loadError && (
          <Notice tone="error">
            Valuation sources could not be loaded.{" "}
            <Button tone="quiet" onClick={() => setReload((n) => n + 1)}>
              Retry
            </Button>
          </Notice>
        )}
        {updatedPrice && record.origin !== "judgment" && (
          <p className="holding-metadata">
            Updated price: {formatSharePrice(updatedPrice.markMicros!)}/share ·{" "}
            {updatedPrice.markDate
              ? formatDate(updatedPrice.markDate)
              : "Price date unavailable"}{" "}
            <Button tone="quiet" onClick={adoptUpdatedPrice}>
              Use updated price
            </Button>
          </p>
        )}
        {record.origin === "proxy" ? (
          <div className="holding-valuation-preview">
            <p>
              {draft.label} ·{" "}
              {price !== null && Number.isSafeInteger(price)
                ? `${formatSharePrice(price)}/share`
                : "Price unavailable"}{" "}
              · {draft.shareClass || "Share class unreported"}
            </p>
            <p className="holding-metadata">
              {draft.priceDate
                ? formatDate(draft.priceDate)
                : "Price date unavailable"}{" "}
              {draft.basis &&
                ` · ${draft.basis === "1" ? "Before split" : `${draft.basis} shares per original share`}`}
            </p>
            <p className="holding-metadata">
              Follows future accepted prices from this source.
            </p>
            {crossClass && (
              <HoldingSelect
                label="Different share class"
                value={draft.crossClass}
                onChange={(v) => update("crossClass", v)}
                options={[
                  { value: "", label: "Choose proxy treatment" },
                  {
                    value: "accepted",
                    label: "Use as an indicative cross-class proxy",
                  },
                ]}
              />
            )}
            {crossClass && (
              <p className="holding-metadata">
                {draft.shareClass} price for{" "}
                {details.lots
                  .map((l) => l.shareClass)
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .join(" / ")}{" "}
                shares. Security rights may differ.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="holding-fields">
              <HoldingInput
                label="Position total · $"
                value={draft.total}
                onChange={(v) => update("total", v)}
                numeric
              />
              <HoldingInput
                label="Share price · $"
                value={draft.price}
                onChange={(v) => update("price", v)}
                numeric
              />
              <HoldingDate
                label="As of"
                value={draft.date}
                onChange={(v) => update("date", v)}
              />
              {draft.total.trim() && (
                <HoldingSelect
                  label="Total includes carry"
                  value={draft.classification}
                  onChange={(v) => update("classification", v)}
                  options={[
                    { value: "before_carry", label: "No · Before carry" },
                    { value: "after_carry", label: "Yes · After carry" },
                    { value: "unknown", label: "Not specified" },
                  ]}
                />
              )}
            </div>
            <Collapsible>
              <CollapsibleTrigger layout="inline">
                Source details
                <DisclosureIndicator />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="holding-fields">
                  {draft.price.trim() && (
                    <HoldingDate
                      label="Share price as of"
                      value={draft.priceDate}
                      onChange={(v) => update("priceDate", v)}
                    />
                  )}
                  <HoldingInput
                    label="Share class"
                    value={draft.shareClass}
                    onChange={(v) => update("shareClass", v)}
                  />
                  <HoldingShareBasis
                    label="Price share basis"
                    value={draft.basis}
                    onChange={(v) => update("basis", v)}
                  />
                  {record.origin === "gp" && (
                    <HoldingInput
                      label="Source name"
                      value={draft.label}
                      onChange={(v) => update("label", v)}
                    />
                  )}
                  <HoldingInput
                    label="Source link"
                    value={draft.url}
                    onChange={(v) => update("url", v)}
                  />
                  {record.origin === "judgment" &&
                    (evidence?.watch.length ?? 0) > 0 && (
                      <HoldingSelect
                        label="Portfolio Watch evidence"
                        value={draft.watch || "none"}
                        onChange={(v) => update("watch", v === "none" ? "" : v)}
                        options={[
                          { value: "none", label: "None" },
                          ...evidence!.watch.map((w) => ({
                            value: w.id,
                            label: w.title,
                          })),
                        ]}
                      />
                    )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
        {record.origin === "judgment" &&
          draft.watch &&
          evidence?.watch.find((w) => w.id === draft.watch) && (
            <p>
              <TextLink
                href={evidence.watch.find((w) => w.id === draft.watch)!.url}
                target="_blank"
                rel="noreferrer"
              >
                {evidence.watch.find((w) => w.id === draft.watch)!.title}
              </TextLink>
            </p>
          )}
        {choices && (
          <>
            {comparable && difference !== 0n && (
              <p className="holding-metadata">
                The totals differ by{" "}
                {formatMoney(
                  Number(difference < 0n ? -difference : difference),
                )}
                .
              </p>
            )}
            <ChoiceGroup
              label="Choose the valuation shown for this holding"
              value={draft.method}
              onValueChange={(v) => update("method", v)}
              options={[
                {
                  value: "total",
                  label:
                    record.origin === "judgment"
                      ? "Your estimate"
                      : "Reported by GP",
                  content: choiceAmount(
                    total!,
                    record.origin === "judgment"
                      ? "Position total you entered"
                      : `${draft.label} · ${formatDate(draft.date)}`,
                    draft.classification === "before_carry"
                      ? "Before carry"
                      : draft.classification === "after_carry"
                        ? "After carry"
                        : "Carry unspecified",
                  ),
                },
                {
                  value: "shares",
                  label: "Calculated from your shares",
                  content: choiceAmount(
                    calculation!.valueMinor,
                    `${decimal(calculation!.quantityMicros, 6)} shares in Investment × ${formatSharePrice(price!)}/share · ${formatDate(draft.priceDate)}`,
                    "Before carry",
                  ),
                },
              ]}
            />
          </>
        )}
        {!choices && draft.method === "shares" && calculation && (
          <div className="holding-valuation-preview">
            <p className="holding-metadata">
              {record.origin === "proxy"
                ? `${record.sourceLabel} price proxy`
                : "Estimated value"}{" "}
              · Before carry
            </p>
            <strong className="holding-choice-amount">
              {formatMoney(calculation.valueMinor)}
            </strong>
            <p className="holding-metadata">
              {calculation.estimatedShares ? "Estimated shares · " : ""}
              {decimal(calculation.quantityMicros, 6)} shares ×{" "}
              {formatSharePrice(price!)}/share
            </p>
          </div>
        )}
        {draft.method === "shares" &&
          draft.price.trim() &&
          !calculation &&
          assessment && (
            <p>
              {!assessment.ok
                ? assessment.message
                : "The investment source changed. Review share coverage in Investment."}
            </p>
          )}
        {drafts[source] && validationError && (
          <Notice tone="error">{validationError}</Notice>
        )}
        {(error || stale) && (
          <Notice tone="error">
            {error ??
              "The source changed. Reload the available sources before saving."}
            {stale && (
              <Button
                tone="quiet"
                disabled={reloadingSources}
                onClick={() => {
                  setReloadingSources(true);
                  void onAccepted()
                    .then(() => {
                      setReload((n) => n + 1);
                    })
                    .catch(() => {
                      setReloadingSources(false);
                      setError("Sources could not be reloaded.");
                    });
                }}
              >
                {reloadingSources && <Spinner />}
                {reloadingSources ? "Reloading sources…" : "Reload sources"}
              </Button>
            )}
          </Notice>
        )}
        <ActionGroup>
          <Button
            type="submit"
            tone="primary"
            disabled={
              !valid ||
              !changed ||
              busy ||
              stale ||
              reloadingSources ||
              (record.origin === "proxy" && Boolean(updatedPrice))
            }
          >
            {busy && <Spinner />}
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button tone="quiet" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
        </ActionGroup>
      </fieldset>
    </form>
  );
}
export type HoldingReceipt = PurchaseReceipt;
