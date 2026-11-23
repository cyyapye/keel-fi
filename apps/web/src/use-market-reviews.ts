import { useEffect, useState } from "react";
import {
  MarketReviewSchema,
  type MarketReview,
} from "@keel/domain/market-close";
import { requestKeel } from "./api-request";
export function useMarketReviews(id?: string | null) {
  const [reviews, setReviews] = useState<MarketReview[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (id === null) return;
    const controller = new AbortController();
    async function read() {
      try {
        const response = await requestKeel(
          id
            ? `/api/exposure-closes/${encodeURIComponent(id)}`
            : "/api/exposure-closes",
          {
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            "Closing-price reviews could not be loaded. Reload to try again.",
          );
        const rows = MarketReviewSchema.array().parse(await response.json());
        if (!controller.signal.aborted) {
          setReviews(rows);
          setError("");
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(
            err instanceof Error
              ? err.message
              : "Closing-price reviews are unavailable.",
          );
      }
    }
    void read();
    const visible = () => {
      if (document.visibilityState === "visible") void read();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [id, revision]);
  return { reviews, error, refresh: () => setRevision((n) => n + 1) };
}
