import { useState } from "react";
import {
  ActionGroup,
  Badge,
  Button,
  LoadingStatus,
  Notice,
  Screen,
  TextLink,
} from "@keel/ui";
import {
  dailyCloseProvider,
  type MarketReview,
} from "@keel/domain/market-close";
import { useMarketReviews } from "./use-market-reviews";
import { requestKeel } from "./api-request";
import { decimal } from "./decimal-input";
import { formatSharePrice } from "./format";
import { ClosingPriceComparison } from "./ClosingPriceComparison";

export function MarketReviewLink({
  review,
  from = "holdings",
  compact = false,
}: {
  review: MarketReview;
  from?: "watch" | "holdings";
  compact?: boolean;
}) {
  return (
    <TextLink
      href={`/${from}?valuation=${encodeURIComponent(review.exposureId)}`}
      aria-label={`${compact ? "Change source" : "Review valuation"} for ${review.name}`}
      className={compact ? "" : "valuation-review-chip"}
    >
      {compact ? (
        "Change source"
      ) : (
        <Badge tone="accent">Review valuation</Badge>
      )}
    </TextLink>
  );
}
export function MarketCloseReview({
  id,
  from,
}: {
  id: string;
  from: "watch" | "holdings";
}) {
  const { reviews, error: readError } = useMarketReviews(id);
  const review = reviews?.find((r) => r.exposureId === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const holdingsHref = `/holdings?exposure=${encodeURIComponent(id)}`;
  const back = from === "watch" ? "/watch?filter=decisions" : holdingsHref;
  async function save(choice: "follow" | "keep") {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await requestKeel(
        `/api/exposure-closes/${encodeURIComponent(id)}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            choice,
            token: review.token,
            requestId: crypto.randomUUID(),
          }),
        },
      );
      if (!res.ok)
        throw new Error(
          res.status === 409
            ? "This valuation changed. Reload to review the latest figures."
            : "Keel could not confirm the save. Reload to check the decision.",
        );
      window.location.assign(
        from === "watch"
          ? `/watch?filter=decisions&reviewed=${encodeURIComponent(id)}`
          : holdingsHref,
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The valuation could not be saved.",
      );
      setBusy(false);
    }
  }
  const provider = review && dailyCloseProvider(review.quote);
  const closeLabel = provider ? "daily close" : "closing price";
  const following = review?.choice === "follow";
  return (
    <Screen>
      <TextLink href={back}>
        Back to {from === "watch" ? "Portfolio Watch" : "Holdings"}
      </TextLink>
      {readError ? (
        <Notice tone="error">{readError}</Notice>
      ) : !reviews ? (
        <LoadingStatus>Loading valuation</LoadingStatus>
      ) : !review ? (
        <p>No eligible positions for this closing price.</p>
      ) : (
        <>
          <ClosingPriceComparison
            closeLabel={closeLabel}
            company={review.name}
            ticker={review.quote.ticker}
            shareClass={review.quote.shareClass}
            price={formatSharePrice(review.quote.priceMicros)}
            date={review.quote.date}
            following={following}
            positions={review.positions.map((p) => ({
              id: p.id,
              name: p.name,
              shares: decimal(p.quantityMicros, 6),
              closeMinor: p.valueMinor,
              priorMinor: p.previousMinor,
              priorSource: p.previousSource,
            }))}
          />
          {error && <Notice tone="error">{error}</Notice>}
          <ActionGroup wrap>
            <Button
              tone="primary"
              disabled={busy}
              onClick={() => void save(following ? "keep" : "follow")}
            >
              {busy
                ? "Saving…"
                : `${following ? "Restore sources" : "Use " + closeLabel} for ${review.positions.length} ${review.positions.length === 1 ? "position" : "positions"}`}
            </Button>
            {following ? (
              <TextLink href={back}>Keep {closeLabel}</TextLink>
            ) : (
              <Button
                tone="quiet"
                disabled={busy}
                onClick={() => void save("keep")}
              >
                Keep current sources
              </Button>
            )}
          </ActionGroup>
        </>
      )}
    </Screen>
  );
}
