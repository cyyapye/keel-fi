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
import {
  formatDate,
  formatMoney,
  formatSavedAt,
  formatSharePrice,
} from "./format";
import { decimal } from "./decimal-input";
import {
  holdingHistorySummary,
  previousHistoryReceipt,
} from "./holding-history-summary";
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
      {page.receipts.map((receipt, i) => (
        <Collapsible key={receipt.id}>
          <CollapsibleTrigger layout="inline">
            <span className="holding-history-entry">
              <span>
                {holdingHistorySummary(
                  receipt,
                  previousHistoryReceipt(page, i),
                )}
              </span>
              <small>{formatSavedAt(receipt.acceptedAt)}</small>
            </span>
            <DisclosureIndicator />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <DataList layout="rows">
              {receipt.details.lots.map((lot, i) => (
                <DataItem
                  key={lot.id}
                  label={
                    receipt.details.lots.length > 1
                      ? `Acquisition ${i + 1}`
                      : "Investment"
                  }
                  value={
                    <>
                      {lot.grossCashMinor !== null &&
                        `${formatMoney(lot.grossCashMinor)} paid`}
                      {lot.capitalReturn && (
                        <small>
                          {formatMoney(lot.capitalReturn.amountMinor)}{" "}
                          {lot.capitalReturn.status === "received"
                            ? "refunded"
                            : "refund expected"}
                        </small>
                      )}
                      {lot.remainingSharesMicros !== null && (
                        <small>
                          {decimal(lot.remainingSharesMicros, 6)} shares
                        </small>
                      )}
                    </>
                  }
                />
              ))}
              {receipt.details.valuation?.records.map((record) => (
                <DataItem
                  key={record.id}
                  label={`${record.sourceLabel}${record.id === receipt.details.valuation?.selected?.recordId ? " · Selected" : ""}`}
                  value={
                    <>
                      {record.totalMinor !== null &&
                        formatMoney(record.totalMinor)}
                      {record.priceMicros !== null && (
                        <small>
                          {formatSharePrice(record.priceMicros)}/share ·{" "}
                          {record.priceDate
                            ? formatDate(record.priceDate)
                            : "Date unknown"}
                        </small>
                      )}
                      <small>
                        {formatDate(record.effectiveDate)} ·{" "}
                        {record.carryStatus.replaceAll("_", " ")}
                      </small>
                    </>
                  }
                />
              ))}
            </DataList>
          </CollapsibleContent>
        </Collapsible>
      ))}
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
