import type {
  HoldingImportPreview,
  HoldingImportRowPreview,
  PublicHoldingReviewEffects,
  PublicHoldingReviewInput,
} from "@keel/domain";
import {
  ActionGroup,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  FormMessage,
  RecordGroup,
  RecordRow,
  SearchSelect,
  TextLink,
} from "@keel/ui";
import { useEffect, useRef, useState } from "react";
import {
  loadHoldingImport,
  loadPublicHoldingReviewEffects,
  refreshPortfolioBaseline,
  reviewPublicHoldingImport,
} from "./api";
import { formatDate, formatMoney } from "./format";

const PAGE_SIZE = 20;
const amount = (value: number | null | undefined) =>
  value === null || value === undefined
    ? "Value unavailable"
    : formatMoney(value);
function shares(value: number | null | undefined) {
  if (value === null || value === undefined) return "Shares not reported";
  const quantity = BigInt(value);
  const remainder = (quantity % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return `${quantity / 1_000_000n}${remainder ? `.${remainder}` : ""} shares`;
}
const decisionLabel = (decision: PublicHoldingReviewInput["decision"]) =>
  ({
    same: "Same holding confirmed",
    separate: "Added as a separate holding",
    ignore: "Reported position ignored",
  })[decision];

export function PublicSourceUpdate({
  importId,
  initialPreview,
  onSaved,
  onClose,
  showDecisions = true,
  showOutcome = true,
  initialActivityOpen = false,
  onSavingChange,
  activityOpen,
}: {
  importId: string;
  initialPreview?: HoldingImportPreview;
  onSaved?: () => Promise<void>;
  onClose?: () => void;
  showDecisions?: boolean;
  showOutcome?: boolean;
  initialActivityOpen?: boolean;
  onSavingChange?: (saving: boolean) => void;
  activityOpen?: boolean;
}) {
  const [preview, setPreview] = useState(initialPreview ?? null);
  const [targetImportId, setTargetImportId] = useState(importId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [choosePrior, setChoosePrior] = useState(false);
  const [priorSelection, setPriorSelection] = useState<{
    rowId: string;
    value: string;
  } | null>(null);
  const [effectsResult, setEffectsResult] = useState<{
    key: string;
    value: PublicHoldingReviewEffects;
  } | null>(null);
  const [effectsFailure, setEffectsFailure] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [saving, setSaving] = useState<
    PublicHoldingReviewInput["decision"] | null
  >(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const working = saving !== null || refreshing;
  const [loading, setLoading] = useState(false);
  const [comparisonRevision, setComparisonRevision] = useState(0);
  const [activityLimit, setActivityLimit] = useState(PAGE_SIZE);
  const [needsStatusCheck, setNeedsStatusCheck] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const savedMessage = useRef<HTMLDivElement>(null);
  const statusButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (error && needsStatusCheck) {
      statusButton.current?.focus();
      statusButton.current?.scrollIntoView({ block: "center" });
    }
  }, [error, needsStatusCheck]);
  useEffect(() => {
    if (initialPreview?.id === targetImportId) return;
    let active = true;
    void loadHoldingImport(targetImportId)
      .then((next) => {
        if (active) {
          setPreview(next);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError("This activity could not be loaded. Try again.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [initialPreview?.id, targetImportId]);
  const unresolved =
    preview?.rows.filter((row) => row.adjudicationStatus === "quarantined") ??
    [];
  const selected =
    preview?.rows.find((row) => row.id === selectedId) ??
    (showDecisions ? unresolved[0] : undefined);
  const candidates = (preview?.priorPositions ?? []).filter(
    (prior) =>
      prior.containerId === selected?.containerId &&
      prior.positionId !== selected.positionId &&
      prior.instrumentType === selected.instrumentType,
  );
  const sameTicker = candidates.filter(
    (item) => item.ticker !== null && item.ticker === selected?.ticker,
  );
  const priorId =
    priorSelection !== null && priorSelection.rowId === selected?.id
      ? priorSelection.value
      : (selected?.sourceReview?.priorPositionId ??
        (sameTicker.length === 1
          ? sameTicker[0]!.positionId
          : candidates.length === 1
            ? candidates[0]!.positionId
            : ""));
  const prior = candidates.find((item) => item.positionId === priorId);
  const previewId = preview?.id;
  const rowId = selected?.id;
  const snapshotId = selected?.currentSnapshotId;
  const comparisonKey = `${previewId}:${rowId}:${snapshotId}:${priorId}:${comparisonRevision}`;
  const effects =
    effectsResult?.key === comparisonKey ? effectsResult.value : null;
  const effectsError =
    effectsFailure === comparisonKey
      ? "The effect on accepted holdings could not be loaded."
      : null;
  useEffect(() => {
    if (!previewId || !rowId) return;
    const controller = new AbortController();
    void loadPublicHoldingReviewEffects(
      previewId,
      rowId,
      priorId || null,
      controller.signal,
    )
      .then((value) => setEffectsResult({ key: comparisonKey, value }))
      .catch(() => {
        if (!controller.signal.aborted) setEffectsFailure(comparisonKey);
      });
    return () => controller.abort();
  }, [comparisonKey, previewId, rowId, priorId]);
  async function readStatus() {
    setLoading(true);
    setError(null);
    try {
      setPreview(await loadHoldingImport(targetImportId));
      setNeedsStatusCheck(false);
      setComparisonRevision((value) => value + 1);
    } catch {
      setError(
        "The decision status is unavailable. Check again before saving.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function save(decision: PublicHoldingReviewInput["decision"]) {
    if (!selected || !preview || working || needsStatusCheck) return;
    setRefreshPending(false);
    setSaving(decision);
    onSavingChange?.(true);
    setError(null);
    setSaved(null);
    try {
      const next = await reviewPublicHoldingImport(preview.id, selected.id, {
        decision,
        expectedReviewId: selected.identityReviewId ?? null,
        expectedSourceSnapshotId: selected.currentSnapshotId ?? null,
        priorPositionId:
          decision === "same" ? (prior?.positionId ?? null) : null,
        expectedPriorSnapshotId:
          decision === "same" ? (prior?.snapshotId ?? null) : null,
      });
      setPreview(next);
      setSelectedId(null);
      window.requestAnimationFrame(() => savedMessage.current?.focus());
      setSaved(`${decisionLabel(decision)}. Your decision is saved.`);
      // Receipt is committed before these independent projection/planning refreshes.
      try {
        await refreshPortfolioBaseline();
        await onSaved?.();
      } catch {
        setRefreshPending(true);
        setSaved(
          `${decisionLabel(decision)}. Your decision is saved; the latest holdings or planning view could not be refreshed.`,
        );
      }
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Keel could not confirm this decision.",
      );
      setNeedsStatusCheck(true);
    } finally {
      setSaving(null);
      onSavingChange?.(false);
    }
  }
  async function retryReadback() {
    if (working) return;
    setRefreshing(true);
    onSavingChange?.(true);
    try {
      await refreshPortfolioBaseline();
      await onSaved?.();
      setRefreshPending(false);
      setSaved("Your decision is saved. Holdings and planning are refreshed.");
    } catch {
      setRefreshPending(true);
    } finally {
      setRefreshing(false);
      onSavingChange?.(false);
    }
  }
  function change(row: HoldingImportRowPreview) {
    if (!row.sourceReview) return;
    setLoading(preview?.id !== row.sourceReview.importId);
    setTargetImportId(row.sourceReview.importId);
    setSelectedId(row.sourceReview.rowId);
    setError(null);
    setSaved(null);
    window.requestAnimationFrame(() => heading.current?.focus());
  }
  if (!preview)
    return (
      <div className="public-source-update" aria-busy={loading}>
        {error ? (
          <FormMessage tone="error">{error}</FormMessage>
        ) : (
          <FormMessage>Loading source activity…</FormMessage>
        )}
        {error && (
          <Button onClick={() => void readStatus()} disabled={loading}>
            Try again
          </Button>
        )}
      </div>
    );
  const applied = preview.summary.autoAppliedCount;
  const kept = preview.preservedPositions ?? [];
  const activity = preview.rows.filter(
    (row) => row.adjudicationStatus !== "quarantined",
  );
  return (
    <section
      className="public-source-update"
      aria-label="Source update"
      aria-busy={working}
    >
      {(showOutcome || saved) && (
        <div className="public-source-update__outcome">
          {showOutcome && (
            <>
              <p>
                <strong>
                  {applied > 0
                    ? `${applied} ${applied === 1 ? "position updated" : "positions updated"} automatically.`
                    : preview.rows.length === 0
                      ? "No positions in the latest report."
                      : preview.status === "pending_review"
                        ? "This report is incomplete. Prior holdings stay unchanged."
                        : "Latest report checked."}{" "}
                  {unresolved.length > 0
                    ? `${unresolved.length} ${unresolved.length === 1 ? "decision needs" : "decisions need"} you.`
                    : "No decisions needed."}
                </strong>
              </p>
              {kept.length > 0 && (
                <p>
                  {kept.length} prior{" "}
                  {kept.length === 1
                    ? "holding keeps its"
                    : "holdings keep their"}{" "}
                  dated values because{" "}
                  {kept.length === 1 ? "it was" : "they were"} not reported. No
                  sale was inferred.
                </p>
              )}
            </>
          )}
          {saved && (
            <div ref={savedMessage} tabIndex={-1}>
              <FormMessage tone="success">{saved}</FormMessage>
              {refreshPending && (
                <Button
                  disabled={working}
                  onClick={() => void retryReadback()}
                  tone="secondary"
                >
                  {refreshing ? "Refreshing…" : "Refresh holdings and planning"}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      {selected && (
        <section
          className="public-source-decision"
          aria-labelledby={`source-decision-${selected.id}`}
        >
          <h3 ref={heading} tabIndex={-1} id={`source-decision-${selected.id}`}>
            {selected.ticker ?? selected.exposureName}: is this the same
            holding?
          </h3>
          <p>
            {selected.acceptanceBlocked
              ? "The source data could not be validated. A corrected report is needed before accepting these facts."
              : selected.sourceReview
                ? "Change how this source position is counted. Compare the earlier accepted holding with the reported values below."
                : "The evidence does not establish a match. Your previous holding is still counted; this reported position is not added until you decide."}
          </p>
          {selected.acceptanceBlocked && selected.issues.length > 0 && (
            <FormMessage tone="error">{selected.issues.join(" ")}</FormMessage>
          )}
          {candidates.length > 1 && (choosePrior || !prior) && (
            <SearchSelect
              label="Prior holding"
              searchLabel="Search prior holdings"
              placeholder="Choose a prior holding"
              items={candidates.map((item) => ({
                value: item.positionId,
                label: `${item.name} · ${item.accountLabel} · ${amount(item.valueMinor)}`,
              }))}
              value={priorId}
              onChange={(value) => {
                if (selected) setPriorSelection({ rowId: selected.id, value });
              }}
              disabled={working || needsStatusCheck}
            />
          )}
          {candidates.length > 1 && !choosePrior && prior && (
            <TextLink
              disabled={working || needsStatusCheck}
              onClick={() => setChoosePrior(true)}
            >
              Compare another holding
            </TextLink>
          )}
          <div className="public-source-decision__compare">
            <div>
              <h4>Previously accepted</h4>
              {prior ? (
                <>
                  <strong>{prior.name}</strong>
                  <p>{prior.accountLabel}</p>
                  <p>
                    {shares(prior.quantityMicros)} · {amount(prior.valueMinor)}
                  </p>
                  <small>As of {formatDate(prior.observedAt)}</small>
                </>
              ) : (
                <p>
                  Choose a prior holding to compare. You can also keep this as a
                  separate holding or ignore it.
                </p>
              )}
            </div>
            <div>
              <h4>Reported by source</h4>
              <strong>{selected.exposureName}</strong>
              <p>{selected.ownerLabel}</p>
              <p>
                {shares(
                  selected.currentQuantityMicros ?? selected.quantityMicros,
                )}{" "}
                ·{" "}
                {amount(
                  selected.currentValueMinor ?? selected.administratorNavMinor,
                )}
              </p>
              <small>
                As of{" "}
                {formatDate(selected.currentObservedAt ?? preview.observedAt)}
              </small>
            </div>
          </div>
          {selected.sourceReview && (
            <p>
              Current decision:{" "}
              <strong>{decisionLabel(selected.sourceReview.decision)}.</strong>
            </p>
          )}
          <div className="public-source-decision__choices">
            {(["same", "separate", "ignore"] as const).map((decision) => {
              const total =
                effects?.[
                  decision === "same"
                    ? "sameTotalMinor"
                    : decision === "separate"
                      ? "separateTotalMinor"
                      : "ignoreTotalMinor"
                ];
              const isCurrent =
                selected.sourceReview?.appliesToThisReport &&
                selected.sourceReview.decision === decision &&
                (decision !== "same" ||
                  selected.sourceReview.priorPositionId === priorId);
              return (
                <div className="public-source-decision__choice" key={decision}>
                  <div>
                    <strong>
                      {decision === "same"
                        ? "Same holding · update it"
                        : decision === "separate"
                          ? "Separate holding · add it"
                          : "Ignore this reported position"}
                    </strong>
                    <p>
                      {decision === "same"
                        ? "Count one holding and reuse this match on later reports."
                        : decision === "separate"
                          ? "Keep the prior holding and count this position separately."
                          : selected.sourceReview?.decision === "same" && prior
                            ? `This report only; repeated copies won’t ask again. Restore ${prior.name} to its ${formatDate(prior.observedAt)} accepted value of ${amount(prior.valueMinor)}.`
                            : "This report only; repeated copies won’t ask again. Prior holdings stay unchanged."}
                    </p>
                    <p>
                      {effects
                        ? `Accepted holdings after this choice: ${total === null ? "total unavailable" : amount(total)}`
                        : "Calculating effect on accepted holdings…"}
                    </p>
                  </div>
                  <Button
                    tone={decision === "same" ? "primary" : "secondary"}
                    disabled={
                      working ||
                      loading ||
                      needsStatusCheck ||
                      isCurrent ||
                      !effects ||
                      (decision !== "ignore" &&
                        selected.acceptanceBlocked !== false) ||
                      (decision === "same" && !prior)
                    }
                    onClick={() => void save(decision)}
                  >
                    {saving === decision
                      ? "Saving…"
                      : isCurrent
                        ? "Current decision"
                        : decision === "same"
                          ? "Confirm same holding"
                          : decision === "separate"
                            ? "Add separately"
                            : "Ignore for this report"}
                  </Button>
                </div>
              );
            })}
          </div>
          {effectsError && (
            <FormMessage tone="error">
              {effectsError}{" "}
              <TextLink onClick={() => void readStatus()}>
                Reload comparison
              </TextLink>
            </FormMessage>
          )}
          {error && (
            <FormMessage
              id={`source-decision-error-${selected.id}`}
              tone="error"
            >
              {error}
            </FormMessage>
          )}
          {needsStatusCheck && (
            <Button
              ref={statusButton}
              aria-describedby={`source-decision-error-${selected.id}`}
              onClick={() => void readStatus()}
              disabled={loading}
            >
              {loading ? "Checking…" : "Check decision status"}
            </Button>
          )}
          {selectedId && (
            <TextLink disabled={working} onClick={() => setSelectedId(null)}>
              Close decision
            </TextLink>
          )}
        </section>
      )}
      <Collapsible
        className="public-source-activity"
        defaultOpen={initialActivityOpen}
        open={activityOpen}
      >
        {activityOpen === undefined && (
          <CollapsibleTrigger>
            Latest activity <DisclosureIndicator />
          </CollapsibleTrigger>
        )}
        <CollapsibleContent id={`source-activity-${importId}`}>
          <RecordGroup aria-label="Latest source activity">
            {kept.slice(0, activityLimit).map((position) => (
              <RecordRow
                key={position.positionId}
                title={`${position.name} · value kept`}
                detail={`${position.accountLabel} · ${shares(position.quantityMicros)}`}
                value={amount(position.valueMinor)}
                metadata={`Not reported in this update · Last accepted ${formatDate(position.observedAt)}`}
              />
            ))}
            {activity
              .slice(0, Math.max(0, activityLimit - kept.length))
              .map((row) => (
                <RecordRow
                  key={row.id}
                  title={`${row.exposureName} · ${row.sourceReview ? decisionLabel(row.sourceReview.decision) : row.adjudicationStatus === "ignored" ? "Older observation ignored" : row.action === "no_change" ? "No change" : "Updated automatically"}`}
                  detail={row.ownerLabel}
                  value={amount(
                    row.currentValueMinor ?? row.administratorNavMinor,
                  )}
                  metadata={`Reported ${formatDate(preview.observedAt)}${row.sourceReview ? ` · ${row.sourceReview.decisionSource === "manual" ? "Your decision" : "Verified identity match"}` : ""}`}
                  action={
                    row.sourceReview && (
                      <TextLink disabled={working} onClick={() => change(row)}>
                        Change decision
                      </TextLink>
                    )
                  }
                />
              ))}
          </RecordGroup>
          {activity.length + kept.length > activityLimit && (
            <Button
              onClick={() => setActivityLimit((limit) => limit + PAGE_SIZE)}
              tone="quiet"
            >
              Show more activity
            </Button>
          )}
          {activity.length + kept.length === 0 && (
            <p>No accepted changes in this report.</p>
          )}
        </CollapsibleContent>
      </Collapsible>
      {onClose && (
        <ActionGroup>
          <Button disabled={working} onClick={onClose} tone="quiet">
            Back to holdings
          </Button>
        </ActionGroup>
      )}
    </section>
  );
}
