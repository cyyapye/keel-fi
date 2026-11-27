import {
  addMinorUnits,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineException,
  PortfolioBaselineStateSchema,
} from "../../packages/domain/src/index";
import {
  automaticReadyState,
  cashException,
  removedException,
} from "../portfolio-baseline-fixtures";

const holdingOverlap: PortfolioBaselineException = {
  key: "position:synthetic-new",
  kind: "position",
  name: "Synthetic incoming holding",
  context: removedException.context,
  reason: "overlap",
  previousValueMinor: null,
  previousObservedAt: null,
  proposedValueMinor: 75_000,
  fiEligibleChangeMinor: 75_000,
};

export const routineExamples = [
  "Routine update",
  "Refresh fails once",
] as const;
export const reviewExamples = [
  "Possible cash overlap",
  "Possible holding overlap",
  "Decision save fails once",
] as const;
export type Example =
  (typeof routineExamples)[number] | (typeof reviewExamples)[number];

export function exampleSource(example: Example) {
  const exceptions =
    example === "Possible holding overlap"
      ? [holdingOverlap, removedException]
      : example === "Possible cash overlap" ||
          example === "Decision save fails once"
        ? [cashException, removedException]
        : [];
  // The synthetic public position moved from $228,000 to $238,000. The
  // established baseline also contains $25,000 of cash held elsewhere.
  let state = PortfolioBaselineStateSchema.parse({
    ...automaticReadyState,
    exceptions,
    baseForecastSnapshotId:
      automaticReadyState.latestBaseline.forecastSnapshotId,
    baseForecastSnapshotVersion:
      automaticReadyState.latestBaseline.forecastSnapshotVersion,
    automaticUpdateCount: 1,
    planning: {
      ...automaticReadyState.planning,
      currentFiEligibleLiquidMinor: 25_300_000,
    },
    latestBaseline: {
      ...automaticReadyState.latestBaseline,
      fiEligibleLiquidMinor: 25_300_000,
    },
  });
  let routineChangeMinor = 1_000_000;
  let failRefresh = example === "Refresh fails once";
  let failSave = example === "Decision save fails once";

  function record(
    changeMinor: number,
    otherCashMinor: number,
    pending: PortfolioBaselineException[],
  ) {
    const previous = state.latestBaseline!;
    const version = state.baseForecastSnapshotVersion! + 1;
    const liquid = addMinorUnits(
      state.planning.currentFiEligibleLiquidMinor,
      changeMinor,
    );
    state = {
      ...state,
      status: pending.length || routineChangeMinor ? "ready" : "current",
      changes: { positions: [], cashAccounts: [] },
      exceptions: pending,
      automaticUpdateCount: routineChangeMinor ? 1 : 0,
      baseForecastSnapshotId: "synthetic-forecast-" + version,
      baseForecastSnapshotVersion: version,
      latestBaseline: {
        ...previous,
        id: "synthetic-baseline-" + version,
        priorFiEligibleLiquidMinor: previous.fiEligibleLiquidMinor,
        fiEligibleLiquidMinor: liquid,
        otherFiEligibleLiquidMinor: otherCashMinor,
        forecastSnapshotVersion: version,
        forecastSnapshotId: "synthetic-forecast-" + version,
      },
      suggestedOtherFiEligibleLiquidMinor: otherCashMinor,
      planning: { ...state.planning, currentFiEligibleLiquidMinor: liquid },
    };
  }

  return {
    load: () => Promise.resolve(state),
    refresh: async (signal?: AbortSignal) => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      signal?.throwIfAborted();
      if (failRefresh) {
        failRefresh = false;
        throw new Error("Planning values could not be refreshed.");
      }
      const change = routineChangeMinor;
      routineChangeMinor = 0;
      record(
        change,
        state.suggestedOtherFiEligibleLiquidMinor,
        state.exceptions ?? [],
      );
      return state;
    },
    confirm: (input: PortfolioBaselineConfirmInput) => {
      if (failSave) {
        failSave = false;
        return Promise.reject(
          new Error("The decision could not be saved. Try again."),
        );
      }
      const pending = state.exceptions ?? [];
      const selected = pending.find(
        (item) => item.key === input.reviewedExceptionKeys?.[0],
      );
      if (
        !selected ||
        input.reviewedExceptionKeys?.length !== 1 ||
        input.baseForecastSnapshotId !== state.baseForecastSnapshotId ||
        input.baseForecastSnapshotVersion !==
          state.baseForecastSnapshotVersion ||
        input.sourceRevision !== state.sourceRevision
      )
        return Promise.reject(
          new Error("The portfolio changed. Reload before saving."),
        );
      let remaining = pending.filter((item) => item !== selected);
      // Removing the only missing source in this sample removes the ambiguity.
      // The newly eligible holding enters on the subsequent routine refresh.
      if (
        selected.key === removedException.key &&
        remaining.some((item) => item.key === holdingOverlap.key)
      ) {
        routineChangeMinor = holdingOverlap.fiEligibleChangeMinor;
        remaining = remaining.filter((item) => item.key !== holdingOverlap.key);
      }
      record(
        addMinorUnits(
          selected.fiEligibleChangeMinor,
          input.otherFiEligibleLiquidMinor,
          -state.suggestedOtherFiEligibleLiquidMinor,
        ),
        input.otherFiEligibleLiquidMinor,
        remaining,
      );
      return Promise.resolve();
    },
  };
}
