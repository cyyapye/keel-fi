import {
  portfolioBaselineReviewReasons,
  type PortfolioBaselineState,
} from "@keel/domain";

type ReadBaseline = (signal?: AbortSignal) => Promise<PortfolioBaselineState>;

/** Read the projection first. Only accepted-source changes eligible for the
 * established baseline trigger the separate refresh operation. */
export async function readPlanningBaseline(
  {
    load,
    refresh,
    display,
    onBaselineChanged,
  }: {
    load: ReadBaseline;
    refresh: ReadBaseline;
    display: (state: PortfolioBaselineState) => void;
    onBaselineChanged?: () => Promise<void>;
  },
  signal?: AbortSignal,
) {
  const next = await load(signal);
  display(next);
  if (
    next.status === "ready" &&
    (next.automaticUpdateCount !== undefined
      ? next.automaticUpdateCount > 0
      : portfolioBaselineReviewReasons(next).length === 0)
  ) {
    const refreshed = await refresh(signal);
    display(refreshed);
    if (
      refreshed.latestBaseline?.id !== next.latestBaseline?.id &&
      !signal?.aborted
    )
      await onBaselineChanged?.();
  }
}
