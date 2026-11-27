import { useEffect, useRef, useState } from "react";
import {
  addMinorUnits,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineState,
} from "@keel/domain";
import {
  ActionGroup,
  Button,
  Field,
  Input,
  InputGroup,
  Notice,
} from "@keel/ui";
import {
  dollarInputToMinorUnits,
  minorUnitsToDollarInput,
  formatDate,
  formatMoney,
} from "./format";

export const PORTFOLIO_BASELINE_CHANGE_PAGE_SIZE = 12;

export function BaselineRefreshStatus({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return error === null ? (
    <p role="status">Updating planning values…</p>
  ) : (
    <section className="portfolio-baseline portfolio-baseline--error">
      <Notice tone="error">{error}</Notice>
      <Button onClick={onRetry} tone="secondary">
        Retry automatic update
      </Button>
    </section>
  );
}

export function PortfolioBaselineExceptions({
  state,
  onConfirm,
  onUpdated,
}: {
  state: PortfolioBaselineState;
  onConfirm: (input: PortfolioBaselineConfirmInput) => Promise<unknown>;
  onUpdated: () => Promise<void>;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(
    PORTFOLIO_BASELINE_CHANGE_PAGE_SIZE,
  );
  const [cashInput, setCashInput] = useState(
    minorUnitsToDollarInput(state.suggestedOtherFiEligibleLiquidMinor),
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (selectedKey !== null) headingRef.current?.focus();
  }, [selectedKey]);
  const exceptions = state.exceptions ?? [];
  const selected = exceptions.find((item) => item.key === selectedKey);
  const explanations = {
    removed:
      "This source is no longer included in synced planning sources. Its previous value stays in your plan until you decide to remove it.",
    unavailable:
      "The latest source has no usable value. Your plan keeps its previous treatment until you decide otherwise.",
    cash_overlap:
      "This newly linked cash may already be included in cash held elsewhere. It stays outside your plan until you check for double counting.",
    overlap:
      "This new source appeared alongside a missing source in the same account or ownership scope. Review the missing source first if this is its replacement, or include it as a separate source.",
  };
  const reasonLabels = {
    removed: "Source no longer included",
    unavailable: "Value unavailable",
    cash_overlap: "Possible cash overlap",
    overlap: "Possible holding overlap",
  };
  const otherCash =
    selected?.reason === "cash_overlap"
      ? dollarInputToMinorUnits(cashInput)
      : state.suggestedOtherFiEligibleLiquidMinor;
  const proposedLiquid =
    selected === undefined || otherCash === null
      ? null
      : addMinorUnits(
          state.planning.currentFiEligibleLiquidMinor,
          selected.fiEligibleChangeMinor,
          otherCash,
          -state.suggestedOtherFiEligibleLiquidMinor,
        );
  const apply = async () => {
    if (
      selected === undefined ||
      otherCash === null ||
      state.sourceRevision === null ||
      state.baseForecastSnapshotId === null ||
      state.baseForecastSnapshotVersion === null
    )
      return;
    setWorking(true);
    setError(null);
    try {
      await onConfirm({
        sourceRevision: state.sourceRevision,
        baseForecastSnapshotId: state.baseForecastSnapshotId,
        baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
        otherFiEligibleLiquidMinor: otherCash,
        duplicateReviewConfirmed: selected.reason === "overlap",
        cashOverlapReviewConfirmed: true,
        reviewedExceptionKeys: [selected.key],
        changeNote:
          `${reasonLabels[selected.reason]}: reviewed ${selected.name}.`.slice(
            0,
            500,
          ),
      });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The decision could not be saved. Try again.",
      );
      setWorking(false);
      return;
    }
    setSelectedKey(null);
    try {
      await onUpdated();
    } catch {
      setError(
        "Your decision was saved, but the plan could not be reloaded. Refresh to see it.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <section
      className="portfolio-baseline-review"
      aria-labelledby="baseline-exceptions-title"
    >
      <header className="portfolio-baseline-review__heading">
        <p className="eyebrow">Planning baseline</p>
        <h2 id="baseline-exceptions-title" ref={headingRef} tabIndex={-1}>
          {selected === undefined
            ? `${exceptions.length} ${exceptions.length === 1 ? "source needs" : "sources need"} your decision`
            : selected.name}
        </h2>
        <p>
          {selected === undefined
            ? "Routine updates are applied automatically. These sources keep their previous planning treatment until you decide."
            : explanations[selected.reason]}
        </p>
      </header>
      {selected === undefined ? (
        <div className="baseline-position-list">
          {exceptions.slice(0, visibleCount).map((item) => (
            <article key={item.key}>
              <div>
                <strong>{item.name}</strong>
                <span>{item.context}</span>
                <small>{reasonLabels[item.reason]}</small>
              </div>
              <Button
                tone="secondary"
                aria-label={`Review ${item.name}`}
                onClick={() => {
                  setSelectedKey(item.key);
                  setCashInput(
                    minorUnitsToDollarInput(
                      state.suggestedOtherFiEligibleLiquidMinor,
                    ),
                  );
                  setError(null);
                }}
              >
                Review
              </Button>
            </article>
          ))}
          {visibleCount < exceptions.length && (
            <Button
              tone="quiet"
              onClick={() =>
                setVisibleCount(
                  (count) => count + PORTFOLIO_BASELINE_CHANGE_PAGE_SIZE,
                )
              }
            >
              Show more
            </Button>
          )}
        </div>
      ) : (
        <>
          <p>{selected.context}</p>
          <div className="baseline-liquid-composition">
            <div className="baseline-liquid-composition__row">
              <span>Currently used by the plan</span>
              <strong>
                {selected.previousValueMinor === null
                  ? "No reported value included"
                  : formatMoney(selected.previousValueMinor)}
              </strong>
            </div>
            {selected.previousObservedAt !== null && (
              <p>
                Previous value as of {formatDate(selected.previousObservedAt)}
              </p>
            )}
            <div className="baseline-liquid-composition__row">
              <span>Latest source value</span>
              <strong>
                {selected.proposedValueMinor === null
                  ? "Unavailable"
                  : formatMoney(selected.proposedValueMinor)}
              </strong>
            </div>
            {selected.reason === "cash_overlap" && (
              <Field htmlFor="exception-other-cash" label="Cash held elsewhere">
                <InputGroup prefix="$">
                  <Input
                    aria-label="Cash held elsewhere"
                    id="exception-other-cash"
                    inputMode="decimal"
                    value={cashInput}
                    onChange={(event) =>
                      setCashInput(event.currentTarget.value)
                    }
                    aria-invalid={otherCash === null || undefined}
                  />
                </InputGroup>
                <p>
                  Reduce this amount if it already includes the newly linked
                  cash.
                </p>
              </Field>
            )}
            <div className="baseline-liquid-composition__row">
              <span>
                {selected.reason === "removed"
                  ? "Effect of removing this source"
                  : "FI-eligible liquid after this decision"}
              </span>
              <strong>
                {formatMoney(state.planning.currentFiEligibleLiquidMinor)} →{" "}
                {proposedLiquid === null
                  ? "Enter a valid amount"
                  : formatMoney(proposedLiquid)}
              </strong>
            </div>
          </div>
          {selected.reason === "unavailable" && (
            <p>
              Excluding the unavailable value removes its contribution from this
              plan. It does not record a sale or change the source holding.
            </p>
          )}
          <ActionGroup as="footer" layout="split" mobileLayout="stack">
            <Button
              tone="quiet"
              disabled={working}
              onClick={() => setSelectedKey(null)}
            >
              Decide later
            </Button>
            {
              <Button
                tone="primary"
                disabled={working || otherCash === null}
                onClick={() => void apply()}
              >
                {working
                  ? "Saving…"
                  : selected.reason === "removed"
                    ? "Remove from plan"
                    : selected.reason === "unavailable"
                      ? "Exclude unavailable value"
                      : selected.reason === "overlap"
                        ? "Include as separate source"
                        : "Include cash with this amount"}
              </Button>
            }
          </ActionGroup>
        </>
      )}
      {error !== null && <Notice tone="error">{error}</Notice>}
    </section>
  );
}
