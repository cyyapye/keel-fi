import type {
  HoldingImportApplyInput,
  HoldingImportApplyResult,
  HoldingImportPreview,
} from "@keel/domain";
import { ActionGroup, Button, Checkbox, Notice, Panel } from "@keel/ui";
import { useState } from "react";
import { formatDate, formatMoney } from "./format";

export function HoldingImportOutcome({
  preview,
  providerName,
  onApply,
  onClose,
}: {
  preview: HoldingImportPreview;
  providerName: string;
  onApply: (
    id: string,
    input: HoldingImportApplyInput,
  ) => Promise<HoldingImportApplyResult>;
  onClose: () => void;
}) {
  const exceptions = preview.rows.filter((row) => row.decisionSource === null);
  const [accepted, setAccepted] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [visibleCount, setVisibleCount] = useState(12);
  const [working, setWorking] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ignoredCount = preview.rows.filter(
    (row) => row.adjudicationStatus === "ignored",
  ).length;
  const complete = resolved || exceptions.length === 0;

  const resolve = async () => {
    setWorking(true);
    setError(null);
    try {
      await onApply(preview.id, {
        currency: "USD",
        decisions: exceptions.map((row) => ({
          rowId: row.id,
          decision: accepted.has(row.id)
            ? ("accepted" as const)
            : ("rejected" as const),
          rationale: accepted.has(row.id)
            ? "Confirmed the legal position and owner for this source update."
            : "Kept the prior position unchanged and dismissed this source exception.",
        })),
      });
      setResolved(true);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "These exceptions could not be resolved. Try again.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      className="holding-import-workspace"
      aria-labelledby="holding-import-outcome-title"
      aria-busy={working}
    >
      <div className="import-heading">
        <p className="eyebrow">
          {providerName} update · {formatDate(preview.observedAt)}
        </p>
        <h2 id="holding-import-outcome-title">
          {complete
            ? resolved
              ? "Exceptions resolved"
              : "Update complete"
            : `${exceptions.length} ${exceptions.length === 1 ? "position needs" : "positions need"} attention`}
        </h2>
        <p>
          {preview.summary.autoAppliedCount} positions recorded automatically
          {preview.summary.unchangedCount > 0
            ? ` · ${preview.summary.unchangedCount} unchanged`
            : ""}
          {ignoredCount > 0 ? ` · ${ignoredCount} older updates skipped` : ""}.
        </p>
        {complete ? (
          <p>No further review is needed.</p>
        ) : (
          <p>
            Confirm only the uncertain positions below. Unselected updates leave
            your prior holdings unchanged.
          </p>
        )}
      </div>
      {!complete && (
        <>
          <Panel className="table-panel import-table-panel">
            <div className="holdings-table-wrap">
              <table className="data-table import-table">
                <caption className="visually-hidden">Import exceptions</caption>
                <thead>
                  <tr>
                    <th>Legal position</th>
                    <th>Owner</th>
                    <th>Source value</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptions.slice(0, visibleCount).map((row) => (
                    <tr key={row.id}>
                      <td data-label="Legal position">
                        <strong>{row.positionName}</strong>
                        <span>{row.exposureName}</span>
                      </td>
                      <td data-label="Owner">{row.ownerLabel}</td>
                      <td data-label="Source value">
                        {row.administratorNavMinor === null
                          ? row.administratorNavState === "locked"
                            ? "Locked by source"
                            : "Not reported"
                          : formatMoney(row.administratorNavMinor)}
                      </td>
                      <td data-label="Decision">
                        {row.issues.map((issue) => (
                          <p key={issue}>{issue}</p>
                        ))}
                        {row.action === "needs_attention" ? (
                          <p>
                            Correct the source and import it again, or dismiss
                            this update.
                          </p>
                        ) : (
                          <Checkbox
                            className="import-row-selection"
                            label="Accept this position update"
                            accessibleLabel={`Accept update for ${row.positionName}`}
                            checked={accepted.has(row.id)}
                            disabled={working}
                            onCheckedChange={(checked) => {
                              setAccepted((current) => {
                                const next = new Set(current);
                                if (checked) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              });
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {exceptions.length > visibleCount && (
            <Button
              onClick={() => setVisibleCount((count) => count + 12)}
              tone="secondary"
            >
              Show more exceptions
            </Button>
          )}
        </>
      )}
      {error !== null && <Notice tone="error">{error}</Notice>}
      <ActionGroup align="end" className="import-actions" mobileLayout="grid">
        <Button
          onClick={onClose}
          tone={complete ? "primary" : "quiet"}
          disabled={working}
        >
          {complete ? "Back to holdings" : "Review later"}
        </Button>
        {!complete && (
          <Button
            onClick={() => void resolve()}
            tone="primary"
            disabled={working}
          >
            {working
              ? "Saving…"
              : accepted.size === 0
                ? "Dismiss exceptions"
                : `Apply ${accepted.size} and dismiss the rest`}
          </Button>
        )}
      </ActionGroup>
    </section>
  );
}
