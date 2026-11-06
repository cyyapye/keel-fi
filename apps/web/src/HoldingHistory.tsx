import { useEffect, useId, useState } from "react";
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
  LoadingStatus,
} from "@keel/ui";
import { formatSavedAt } from "./format";
import { holdingHistorySummary } from "./holding-history-summary";
import { holdingHistoryChanges } from "./holding-history-changes";
type History = ReturnType<typeof InvestmentHistorySchema.parse>;
type IdentityEntry = Extract<History["entries"][number], { kind: "identity" }>;
function identityChanges(entry: IdentityEntry) {
  const typeLabel = (kind: IdentityEntry["receipt"]["value"]["kind"]) =>
    ({ direct: "Direct", spv_interest: "SPV", fund_interest: "Fund" })[kind];
  const companies = (value: IdentityEntry["receipt"]["value"]) =>
    [...value.companies]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((company) => company.name)
      .join(", ") || "Unassigned";
  const current = entry.receipt.value;
  const previous = entry.previous;
  return [
    {
      key: "name",
      label: "Name",
      before: previous?.name ?? null,
      after: current.name,
    },
    {
      key: "kind",
      label: "Investment type",
      before: previous ? typeLabel(previous.kind) : null,
      after: typeLabel(current.kind),
    },
    {
      key: "owner",
      label: "Held by",
      before: previous?.ownerLabel ?? null,
      after: current.ownerLabel,
    },
    {
      key: "company",
      label: "Company",
      before: previous ? companies(previous) : null,
      after: companies(current),
    },
  ].filter((change) => change.before !== change.after);
}
export function HoldingHistory({ positionId }: { positionId: string }) {
  const historyId = useId();
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
  if (!page) return <LoadingStatus>Loading history…</LoadingStatus>;
  return (
    <div className="holding-receipt-history">
      {page.entries.map((entry, index) => {
        const receipt = entry.receipt;
        const changes =
          entry.kind === "investment"
            ? holdingHistoryChanges(entry.receipt, entry.previous)
            : entry.kind === "identity"
              ? [
                  ...identityChanges(entry),
                  ...(entry.receipt.initialInvestment
                    ? holdingHistoryChanges(
                        entry.receipt.initialInvestment,
                        null,
                      ).map((change) => ({
                        ...change,
                        key: `initial:${change.key}`,
                      }))
                    : []),
                ]
              : [];
        const summary =
          entry.kind === "investment"
            ? holdingHistorySummary(entry.receipt, entry.previous)
            : entry.kind === "identity"
              ? entry.previous
                ? "Holding details corrected"
                : "Holding created"
              : `${entry.receipt.state === "linked" ? "Linked" : "Unlinked"} · ${entry.sourceLabel} → ${entry.targetLabel}`;
        const timeId = `${historyId}-${index}-time`;
        const time = (
          <time id={timeId} dateTime={receipt.acceptedAt}>
            {formatSavedAt(receipt.acceptedAt)}
          </time>
        );
        if (
          (entry.kind === "investment" || entry.kind === "identity") &&
          changes.length === 0
        )
          return (
            <div
              className="holding-history-line"
              key={`${entry.kind}:${receipt.id}`}
            >
              <span>{summary}</span>
              {time}
            </div>
          );
        return (
          <Collapsible key={`${entry.kind}:${receipt.id}`}>
            <div className="holding-history-line">
              <CollapsibleTrigger
                layout="inline"
                className="holding-history-entry"
                aria-describedby={timeId}
              >
                <span>{summary}</span>
                <DisclosureIndicator />
              </CollapsibleTrigger>
              {time}
            </div>
            <CollapsibleContent>
              {entry.kind === "investment" || entry.kind === "identity" ? (
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
