import { useEffect, useState } from "react";
import { InvestmentHistorySchema } from "@keel/domain/position-purchases";
import {
  Button,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  DataList,
  DataItem,
  DisclosureIndicator,
  Notice,
} from "@keel/ui";
import { formatSavedAt } from "./format";
import { holdingHistorySummary } from "./holding-history-summary";
import { holdingHistoryChanges } from "./holding-history-changes";
type History = ReturnType<typeof InvestmentHistorySchema.parse>;
export function HoldingHistory({ positionId }: { positionId: string }) {
  const [page, setPage] = useState<History | null>(null);
  const [cursor, setCursor] = useState<History["next"]>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/investment-positions/${encodeURIComponent(positionId)}/history${cursor ? `?${new URLSearchParams(cursor)}` : ""}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const result = InvestmentHistorySchema.parse(await response.json());
        if (!controller.signal.aborted) {
          setPage(result);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [positionId, cursor, retry]);
  if (failed)
    return (
      <Notice tone="error">
        History could not be loaded.{" "}
        <Button tone="quiet" onClick={() => setRetry((n) => n + 1)}>
          Retry
        </Button>
      </Notice>
    );
  if (!page) return <p>Loading history…</p>;
  return (
    <div className="holding-receipt-history">
      {page.entries.map((entry) => {
        const receipt = entry.receipt;
        const changes =
          entry.kind === "investment"
            ? holdingHistoryChanges(entry.receipt, entry.previous)
            : [];
        const summary =
          entry.kind === "investment"
            ? holdingHistorySummary(entry.receipt, entry.previous)
            : `${entry.receipt.state === "linked" ? "Linked" : "Unlinked"} · ${entry.sourceLabel} → ${entry.targetLabel}`;
        const heading = (
          <span className="holding-history-entry">
            <span>{summary}</span>
            <time dateTime={receipt.acceptedAt}>
              {formatSavedAt(receipt.acceptedAt)}
            </time>
          </span>
        );
        if (entry.kind === "investment" && changes.length === 0)
          return <div key={`${entry.kind}:${receipt.id}`}>{heading}</div>;
        return (
          <Collapsible key={`${entry.kind}:${receipt.id}`}>
            <CollapsibleTrigger layout="inline">
              {heading}
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              {entry.kind === "investment" ? (
                <DataList layout="rows">
                  {changes.map((change) => (
                    <DataItem
                      key={change.key}
                      label={change.label}
                      value={
                        change.before === null ? (
                          (change.after ?? "Cleared")
                        ) : (
                          <>
                            {change.before} → {change.after ?? "Cleared"}
                          </>
                        )
                      }
                    />
                  ))}
                </DataList>
              ) : (
                <>
                  <p>
                    {entry.receipt.companyRenamed
                      ? `${entry.receipt.formerCompanyName} → ${entry.receipt.companyName}`
                      : entry.receipt.relationship === "replaced"
                        ? "SPV replacement"
                        : "Same investment, another source"}
                  </p>
                  {entry.receipt.state === "unlinked" ? (
                    <p>
                      The source is separate again. Its records and history are
                      retained.
                    </p>
                  ) : (
                    entry.receipt.useSourceValue && (
                      <p>Uses the linked source’s reported value.</p>
                    )
                  )}
                  {entry.receipt.note && <p>{entry.receipt.note}</p>}
                </>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {page.next && (
        <Button tone="quiet" onClick={() => setCursor(page.next)}>
          Earlier history
        </Button>
      )}
      {cursor && (
        <Button tone="quiet" onClick={() => setCursor(null)}>
          Latest history
        </Button>
      )}
    </div>
  );
}
