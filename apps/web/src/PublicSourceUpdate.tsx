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
  Text,
} from "@keel/ui";
import { useEffect, useRef, useState } from "react";
import {
  loadHoldingImport,
  loadPublicHoldingReviewEffects,
  refreshPortfolioBaseline,
  refreshPublicHoldingImportExposures,
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

function SourceInventoryActivity({
  preview,
  working,
  onChangeDecision,
  readOnly = false,
}: {
  preview: HoldingImportPreview;
  working: boolean;
  onChangeDecision?: (row: HoldingImportRowPreview) => void;
  readOnly?: boolean;
}) {
  const [page, setPage] = useState(0);
  const [openDetail, setOpenDetail] = useState<string | null>(null);
  const closed = [...(preview.inventory?.closedPositions ?? [])].sort(
    (left, right) =>
      left.accountLabel.localeCompare(right.accountLabel) ||
      (left.ticker ?? left.name).localeCompare(right.ticker ?? right.name),
  );
  const kept = preview.preservedPositions ?? [];
  const priorQuantities = new Map(
    preview.inventory?.priorQuantities.map((prior) => [
      prior.rowId,
      prior.quantityMicros,
    ]) ?? [],
  );
  const unchangedRows = new Set(
    preview.inventory?.priorQuantities
      .filter((prior) => prior.factsUnchanged)
      .map((prior) => prior.rowId) ?? [],
  );
  const rows = preview.rows.filter(
    (row) => row.adjudicationStatus !== "quarantined",
  );
  const accounts = [
    ...closed.map((position) => ({
      id: position.containerId,
      label: position.accountLabel,
    })),
    ...kept.map((position) => ({
      id: position.containerId,
      label: position.accountLabel,
    })),
    ...rows.map((row) => ({ id: row.containerId, label: row.ownerLabel })),
  ];
  const sharedAccount =
    accounts.length > 0 &&
    accounts[0]!.id &&
    accounts.every((account) => account.id === accounts[0]!.id)
      ? accounts[0]!.label
      : null;
  const accountDetail = (account: string, quantity: string) =>
    sharedAccount ? quantity : [account, quantity].filter(Boolean).join(" · ");
  const records = [
    ...closed.map((position) => ({
      key: position.positionId,
      title: `${position.ticker ?? position.name} · ${position.instrumentType === "cash" ? "No balance counted" : "No longer held"}`,
      detail:
        position.instrumentType === "cash"
          ? accountDetail(position.accountLabel, "")
          : accountDetail(
              position.accountLabel,
              `${shares(position.quantityMicros)} → 0 shares`,
            ),
      value: position.instrumentType === "cash" ? "Not counted" : "0 shares",
      metadata: `${position.instrumentType === "cash" ? "" : "Not counted · "}Complete report ${formatDate(preview.inventory!.sourceUpdatedAt!)}`,
      details: `Last reported value: ${amount(position.valueMinor)} on ${formatDate(position.observedAt)}. Its history is retained. This holdings report does not establish sale price, proceeds or realized return.`,
      row: null,
    })),
    ...kept.map((position) => ({
      key: position.positionId,
      title: `${position.name} · value kept`,
      detail: accountDetail(
        position.accountLabel,
        shares(position.quantityMicros),
      ),
      value: amount(position.valueMinor),
      metadata: `Not reported in this update · Last accepted ${formatDate(position.observedAt)}`,
      details: null,
      row: null,
    })),
    ...rows.map((row) => ({
      key: row.id,
      title: readOnly
        ? row.exposureName
        : `${row.exposureName} · ${preview.inventory?.returnedPositionIds.includes(row.positionId ?? "") ? "Holding returned" : row.sourceReview ? decisionLabel(row.sourceReview.decision) : row.adjudicationStatus === "ignored" ? "Older observation ignored" : row.action === "no_change" || unchangedRows.has(row.id) ? "No change" : row.action === "create_position" ? "Added automatically" : row.instrumentType === "cash" ? "Updated automatically" : priorQuantities.has(row.id) && priorQuantities.get(row.id) !== row.quantityMicros ? "Shares updated" : "Updated automatically"}`,
      detail: accountDetail(
        row.ownerLabel,
        row.instrumentType === "cash"
          ? ""
          : `${priorQuantities.has(row.id) && priorQuantities.get(row.id) !== row.quantityMicros ? `${shares(priorQuantities.get(row.id))} → ` : ""}${shares(row.quantityMicros)}`,
      ),
      value: amount(row.administratorNavMinor),
      metadata: `Reported ${formatDate(preview.inventory?.sourceUpdatedAt ?? preview.observedAt)}${!readOnly && row.sourceReview ? ` · ${row.sourceReview.decisionSource === "manual" ? "Your decision" : "Verified identity match"}` : ""}`,
      details: preview.inventory?.returnedPositionIds.includes(
        row.positionId ?? "",
      )
        ? "The same account and security is active again. Earlier history is retained and the holding is counted once. No purchase price or sale proceeds were inferred."
        : null,
      row,
    })),
  ];
  return (
    <>
      {sharedAccount && (
        <Text id={`source-account-${preview.id}`} variant="supporting">
          {sharedAccount}
        </Text>
      )}
      <RecordGroup
        aria-describedby={
          sharedAccount ? `source-account-${preview.id}` : undefined
        }
        aria-label={
          readOnly ? "Earlier source activity" : "Latest source activity"
        }
      >
        {records
          .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
          .map((record) => (
            <RecordRow
              key={record.key}
              title={record.title}
              detail={
                record.detail ||
                (openDetail === record.key && record.details) ? (
                  <>
                    {record.detail}
                    {openDetail === record.key && record.details && (
                      <Text variant="supporting">{record.details}</Text>
                    )}
                  </>
                ) : undefined
              }
              value={record.value}
              metadata={record.metadata}
              action={
                record.details ? (
                  <TextLink
                    aria-expanded={openDetail === record.key}
                    onClick={() =>
                      setOpenDetail(
                        openDetail === record.key ? null : record.key,
                      )
                    }
                  >
                    {openDetail === record.key ? "Hide details" : "Details"}
                  </TextLink>
                ) : !readOnly &&
                  record.row?.sourceReview &&
                  onChangeDecision ? (
                  <TextLink
                    disabled={working}
                    onClick={() => {
                      if (record.row) onChangeDecision(record.row);
                    }}
                  >
                    Change decision
                  </TextLink>
                ) : undefined
              }
            />
          ))}
      </RecordGroup>
      {records.length === 0 && <p>No accepted changes in this report.</p>}
      {records.length > PAGE_SIZE && (
        <ActionGroup>
          <Button
            tone="quiet"
            disabled={page === 0}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous activity
          </Button>
          <span>
            {page * PAGE_SIZE + 1}–
            {Math.min((page + 1) * PAGE_SIZE, records.length)} of{" "}
            {records.length}
          </span>
          <Button
            tone="quiet"
            disabled={(page + 1) * PAGE_SIZE >= records.length}
            onClick={() => setPage((value) => value + 1)}
          >
            Next activity
          </Button>
        </ActionGroup>
      )}
    </>
  );
}

export function PublicSourceUpdate({
  importId,
  initialPreview,
  onSaved,
  onClose,
  showDecisions = true,
  showOutcome = true,
  initialActivityOpen = false,
  onSavingChange,
  onReadbackPendingChange,
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
  onReadbackPendingChange?: (pending: boolean) => void;
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
  const [earlier, setEarlier] = useState<HoldingImportPreview | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const historyRequest = useRef<AbortController | null>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => () => historyRequest.current?.abort(), []);
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => {
    if (!historyLoading && (historyError || earlier))
      historyTrigger.current?.focus({ preventScroll: true });
  }, [historyLoading, historyError, earlier]);
  async function loadEarlier(id: string) {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const report = await loadHoldingImport(id, controller.signal);
      if (!controller.signal.aborted) setEarlier(report);
    } catch {
      if (!controller.signal.aborted)
        setHistoryError("Earlier activity could not be loaded. Try again.");
    } finally {
      if (!controller.signal.aborted) {
        setHistoryLoading(false);
      }
    }
  }
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
        (sameTicker.length === 1 ? sameTicker[0]!.positionId : ""));
  const prior = candidates.find((item) => item.positionId === priorId);
  const reportedName = selected?.ticker ?? selected?.exposureName;
  const savedPrior = candidates.find(
    (item) => item.positionId === selected?.sourceReview?.priorPositionId,
  );
  const restoresSavedMatch = selected?.sourceReview?.decision === "same";
  const restoration = savedPrior
    ? `Restore ${savedPrior.name} to its ${formatDate(savedPrior.observedAt)} accepted value of ${amount(savedPrior.valueMinor)}.`
    : "Restore the prior holding from your saved match.";
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
    if (working) return;
    setRefreshing(true);
    onSavingChange?.(true);
    setLoading(true);
    setError(null);
    try {
      const next = await loadHoldingImport(targetImportId);
      setPreview(next);
      setNeedsStatusCheck(false);
      setComparisonRevision((value) => value + 1);
      const recorded = next.rows.find(
        (row) => row.id === selected?.id,
      )?.sourceReview;
      if (recorded?.appliesToThisReport) {
        onReadbackPendingChange?.(true);
        setSelectedId(null);
        setChoosePrior(false);
        setPriorSelection(null);
        setSaved(
          `${decisionLabel(recorded.decision)}. Your decision is saved.`,
        );
        window.requestAnimationFrame(() => savedMessage.current?.focus());
        try {
          await finishReadback(next.id);
          onReadbackPendingChange?.(false);
        } catch {
          setRefreshPending(true);
          setSaved(
            `${decisionLabel(recorded.decision)}. Your decision is saved; the latest holdings or planning view could not be refreshed.`,
          );
        }
      }
    } catch {
      setError(
        "The decision status is unavailable. Check again before saving.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
      onSavingChange?.(false);
    }
  }
  async function finishReadback(importId: string) {
    setPreview(await refreshPublicHoldingImportExposures(importId));
    await refreshPortfolioBaseline();
    await onSaved?.();
  }
  async function save(decision: PublicHoldingReviewInput["decision"]) {
    if (!selected || !preview || working || needsStatusCheck || refreshPending)
      return;
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
      onReadbackPendingChange?.(true);
      setPreview(next);
      setSelectedId(null);
      setChoosePrior(false);
      setPriorSelection(null);
      window.requestAnimationFrame(() => savedMessage.current?.focus());
      setSaved(`${decisionLabel(decision)}. Your decision is saved.`);
      // Receipt is committed before these independent projection/planning refreshes.
      try {
        await finishReadback(next.id);
        onReadbackPendingChange?.(false);
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
      await finishReadback(targetImportId);
      onReadbackPendingChange?.(false);
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
    const currentExclusion =
      row.sourceReview.decision === "ignore" &&
      preview?.inventory?.currentContainerIds.includes(row.containerId ?? "");
    setTargetImportId(
      currentExclusion ? preview!.id : row.sourceReview.importId,
    );
    setSelectedId(currentExclusion ? row.id : row.sourceReview.rowId);
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
  const completeInventory = preview.inventory?.complete === true;
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
                  {completeInventory
                    ? preview.inventory!.changeCount === 0
                      ? "Holdings are current. No new changes."
                      : `${preview.inventory!.changeCount} ${preview.inventory!.changeCount === 1 ? "change" : "changes"} applied automatically.`
                    : applied > 0
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
              {preview.inventory && !completeInventory && (
                <p>
                  The latest report did not establish a complete current
                  inventory. Missing positions have not been removed.
                </p>
              )}
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
            {selected.acceptanceBlocked
              ? `${reportedName}: source data needs correction`
              : prior
                ? `${reportedName}: is this the same holding?`
                : `Add ${reportedName} as a new holding?`}
          </h3>
          <p>
            {selected.acceptanceBlocked
              ? "The source data could not be validated. A corrected report is needed before accepting these facts."
              : needsStatusCheck
                ? "Keel could not confirm whether this decision was saved. Check its status before saving again."
                : selected.sourceReview
                  ? prior
                    ? "Change how this source position is counted. Compare the earlier accepted holding with the reported values below."
                    : "Change how this reported position is counted. Review the effect of each choice below."
                  : prior && priorSelection?.rowId === selected.id
                    ? `You chose ${prior.name} to compare with ${reportedName}. Confirm a match only if they are the same holding.`
                    : prior
                      ? "The evidence does not establish a match. Your previous holding is still counted; this reported position is not added until you decide."
                      : `This reported position has not been added.${candidates.length > 0 ? " You can add it as a new holding or match it to an existing holding." : ""}`}
          </p>
          {selected.acceptanceBlocked && selected.issues.length > 0 && (
            <FormMessage tone="error">{selected.issues.join(" ")}</FormMessage>
          )}
          {candidates.length > 0 &&
            !selected.acceptanceBlocked &&
            choosePrior && (
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
                  if (selected)
                    setPriorSelection({ rowId: selected.id, value });
                }}
                disabled={working || needsStatusCheck || refreshPending}
              />
            )}
          {candidates.length > 0 &&
            !selected.acceptanceBlocked &&
            (!choosePrior || prior) && (
              <ActionGroup align="start" mobileLayout="stack">
                {!choosePrior && (!prior || candidates.length > 1) && (
                  <TextLink
                    disabled={working || needsStatusCheck || refreshPending}
                    onClick={() => setChoosePrior(true)}
                  >
                    {prior
                      ? "Compare another holding"
                      : "Match to an existing holding"}
                  </TextLink>
                )}
                {prior && (
                  <TextLink
                    disabled={working || needsStatusCheck || refreshPending}
                    onClick={() => {
                      setPriorSelection({ rowId: selected.id, value: "" });
                      setChoosePrior(false);
                    }}
                  >
                    Add as a new holding instead
                  </TextLink>
                )}
              </ActionGroup>
            )}
          <div
            className="public-source-decision__compare"
            data-has-prior={!!prior}
          >
            {prior && (
              <div>
                <h4>Previously accepted</h4>
                <strong>{prior.name}</strong>
                <p>{prior.accountLabel}</p>
                <p>
                  {shares(prior.quantityMicros)} · {amount(prior.valueMinor)}
                </p>
                <small>As of {formatDate(prior.observedAt)}</small>
              </div>
            )}
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
            {(["same", "separate", "ignore"] as const)
              .filter((decision) => decision !== "same" || prior !== undefined)
              .map((decision) => {
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
                  <div
                    className="public-source-decision__choice"
                    key={decision}
                  >
                    <div>
                      {(decision !== "separate" || prior) && (
                        <strong>
                          {decision === "same"
                            ? "Same holding · update it"
                            : decision === "separate"
                              ? `Add ${reportedName} as a new holding`
                              : "Ignore this reported position"}
                        </strong>
                      )}
                      <p>
                        {decision === "same"
                          ? `Update ${prior!.name} with this reported position. Count one holding and reuse this match on later reports.`
                          : decision === "separate"
                            ? restoresSavedMatch
                              ? `Count both holdings separately. ${restoration}`
                              : "Your existing holdings stay unchanged."
                            : restoresSavedMatch
                              ? `This report only; repeated copies won’t ask again. ${restoration}`
                              : "This report only; repeated copies won’t ask again. Prior holdings stay unchanged."}
                      </p>
                      <p>
                        {effects
                          ? `Accepted holdings after this choice: ${total === null ? "total unavailable" : amount(total)}`
                          : "Calculating effect on accepted holdings…"}
                      </p>
                    </div>
                    <Button
                      tone={
                        decision === "same" ||
                        (decision === "separate" && !prior)
                          ? "primary"
                          : "secondary"
                      }
                      disabled={
                        working ||
                        refreshPending ||
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
                              ? selected.ticker
                                ? `Add ${selected.ticker}`
                                : "Add as a new holding"
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
          <SourceInventoryActivity
            key={preview.id}
            preview={preview}
            working={working || refreshPending}
            onChangeDecision={change}
          />
          {preview.inventory?.previousImportId && (
            <>
              <Button
                ref={historyTrigger}
                tone="quiet"
                disabled={historyLoading}
                onClick={() =>
                  earlier
                    ? setEarlier(null)
                    : void loadEarlier(preview.inventory!.previousImportId!)
                }
              >
                {historyLoading
                  ? "Loading earlier activity…"
                  : earlier
                    ? "Hide earlier activity"
                    : "Earlier activity"}
              </Button>
              {historyError && (
                <FormMessage tone="error">{historyError}</FormMessage>
              )}
              {earlier && (
                <section aria-label="Earlier account report">
                  <h3>
                    {formatDate(
                      earlier.inventory?.sourceUpdatedAt ?? earlier.observedAt,
                    )}{" "}
                    · Earlier report
                  </h3>
                  <Text variant="supporting">
                    Historical activity. Current holdings are unchanged.
                  </Text>
                  <SourceInventoryActivity
                    key={earlier.id}
                    preview={earlier}
                    working={false}
                    readOnly
                  />
                  {earlier.inventory?.previousImportId && (
                    <Button
                      tone="quiet"
                      disabled={historyLoading}
                      onClick={() =>
                        void loadEarlier(earlier.inventory!.previousImportId!)
                      }
                    >
                      Earlier report
                    </Button>
                  )}
                </section>
              )}
            </>
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
