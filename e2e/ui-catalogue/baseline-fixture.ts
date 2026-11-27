import { z } from "zod";
import {
  addMinorUnits,
  createPortfolioBaselineImpact,
  PortfolioBaselineStateSchema,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineException,
  type PortfolioBaselinePosition,
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
  "Source changes during review",
] as const;
const examples = z.enum([...routineExamples, ...reviewExamples]);
export type Example = z.infer<typeof examples>;

// Only the synthetic source and its accepted decisions survive a page reload.
// The visible draft and selected source belong to the mounted product controls.
const progressSchema = z.object({
  example: examples,
  version: z.number().int().positive(),
  acceptedQuote: z.number().int().nonnegative(),
  otherCash: z.number().int().nonnegative(),
  retainedMissing: z.boolean(),
  includedIncoming: z.boolean(),
  includedCash: z.boolean(),
  newReport: z.boolean(),
  failedRefresh: z.boolean(),
});
type Progress = z.infer<typeof progressSchema>;
function storageKey(routine: boolean) {
  return (
    "keel.catalogue.planning-baseline.v1." + (routine ? "routine" : "review")
  );
}
function readProgress(routine: boolean): Progress | null {
  try {
    const result = progressSchema.safeParse(
      JSON.parse(sessionStorage.getItem(storageKey(routine)) ?? "null"),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function savedExample(routine: boolean) {
  return readProgress(routine)?.example;
}
export function restartExample(routine: boolean) {
  sessionStorage.removeItem(storageKey(routine));
}
export function exampleSource(example: Example) {
  const routine =
    example === "Routine update" || example === "Refresh fails once";
  const holding = example === "Possible holding overlap";
  const cash = !routine && !holding;
  // The exception baseline retains $1,000 from the missing holding. Its other
  // public position is $1,000 smaller than the routine example's position.
  const previousQuote = routine ? 22_800_000 : 22_700_000;
  const saved = readProgress(routine);
  const progress: Progress =
    saved?.example === example
      ? saved
      : {
          example,
          version: 4,
          acceptedQuote: previousQuote,
          otherCash: 2_500_000,
          retainedMissing: !routine,
          includedIncoming: false,
          includedCash: false,
          newReport: false,
          failedRefresh: false,
        };
  const save = () =>
    sessionStorage.setItem(storageKey(routine), JSON.stringify(progress));
  const reportedQuote = () =>
    addMinorUnits(previousQuote, 1_000_000, progress.newReport ? 100_000 : 0);
  function projection() {
    const quote = reportedQuote();
    const pending: PortfolioBaselineException[] = [];
    if (holding && !progress.includedIncoming && progress.retainedMissing)
      pending.push(holdingOverlap);
    if (progress.retainedMissing) pending.push(removedException);
    if (cash && !progress.includedCash) pending.push(cashException);
    const autoCount =
      Number(progress.acceptedQuote !== quote) +
      Number(
        holding && !progress.includedIncoming && !progress.retainedMissing,
      );
    const acceptedPublic = addMinorUnits(
      progress.acceptedQuote,
      progress.retainedMissing ? 100_000 : 0,
      progress.includedIncoming ? 75_000 : 0,
    );
    const liquid = addMinorUnits(
      acceptedPublic,
      progress.otherCash,
      progress.includedCash ? 500_000 : 0,
    );
    const planning = {
      ...automaticReadyState.planning,
      currentFiEligibleLiquidMinor: liquid,
    };
    const [stock, ...privateHoldings] = automaticReadyState.positions;
    const positions: PortfolioBaselinePosition[] = [
      { ...stock!, valueMinor: quote },
      ...privateHoldings,
    ];
    if (holding)
      positions.push({
        ...stock!,
        id: "synthetic-new",
        positionName: holdingOverlap.name,
        valueMinor: 75_000,
      });
    const cashAccounts = cash
      ? [
          {
            id: "synthetic-new-cash",
            institutionLabel: "Northstar Demo Bank",
            accountLabel: cashException.name,
            subtype: "savings",
            valueState: "reported",
            refreshKind: "live",
            observedAt: automaticReadyState.observedAt,
            valueMinor: 500_000,
          },
        ]
      : [];
    const summary = {
      ...automaticReadyState.summary,
      positionCount: positions.length,
      publicMarketValueMinor: addMinorUnits(quote, holding ? 75_000 : 0),
      cashAccountCount: cashAccounts.length,
      cashAccountValueMinor: cash ? 500_000 : 0,
    };
    const forecast = "synthetic-forecast-" + progress.version;
    const revision = (progress.newReport ? "e" : "a").repeat(64);
    return PortfolioBaselineStateSchema.parse({
      ...automaticReadyState,
      status: autoCount || pending.length ? "ready" : "current",
      sourceRevision: revision,
      hasSourceChanges: Boolean(autoCount || pending.length),
      canConfirm: pending.length > 0,
      automaticUpdateCount: autoCount,
      exceptions: pending,
      baseForecastSnapshotId: forecast,
      baseForecastSnapshotVersion: progress.version,
      positions,
      cashAccounts,
      summary,
      planning,
      currentImpact: createPortfolioBaselineImpact(planning, liquid),
      suggestedOtherFiEligibleLiquidMinor: progress.otherCash,
      latestBaseline: {
        ...automaticReadyState.latestBaseline,
        id: "synthetic-baseline-" + progress.version,
        forecastSnapshotId: forecast,
        forecastSnapshotVersion: progress.version,
        fiEligibleLiquidMinor: liquid,
        otherFiEligibleLiquidMinor: progress.otherCash,
        summary: {
          ...summary,
          positionCount:
            automaticReadyState.positions.length +
            Number(progress.retainedMissing) +
            Number(progress.includedIncoming),
          publicMarketValueMinor: acceptedPublic,
          cashAccountCount: Number(progress.includedCash),
          cashAccountValueMinor: progress.includedCash ? 500_000 : 0,
        },
      },
      changes: {
        positions:
          progress.acceptedQuote === quote
            ? []
            : [
                {
                  changeType: "updated",
                  current: positions[0],
                  previous: {
                    valueMinor: progress.acceptedQuote,
                    valueState: "reported",
                    observedAt: "2026-08-08T16:00:00.000Z",
                  },
                },
              ],
        cashAccounts: [],
      },
    });
  }

  return {
    load: () => Promise.resolve(projection()),
    refresh: async (signal?: AbortSignal) => {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
      signal?.throwIfAborted();
      if (example === "Refresh fails once" && !progress.failedRefresh) {
        progress.failedRefresh = true;
        save();
        throw new Error("Planning values could not be refreshed. Try again.");
      }
      progress.acceptedQuote = reportedQuote();
      if (holding && !progress.retainedMissing)
        progress.includedIncoming = true;
      progress.version++;
      save();
      return projection();
    },
    confirm: (input: PortfolioBaselineConfirmInput) => {
      if (example === "Source changes during review" && !progress.newReport) {
        progress.newReport = true;
        save();
      }
      const state = projection();
      const key = input.reviewedExceptionKeys?.[0];
      if (
        input.reviewedExceptionKeys?.length !== 1 ||
        !state.exceptions?.some((item) => item.key === key) ||
        input.sourceRevision !== state.sourceRevision ||
        input.baseForecastSnapshotId !== state.baseForecastSnapshotId ||
        input.baseForecastSnapshotVersion !== state.baseForecastSnapshotVersion
      )
        return Promise.reject(
          new Error(
            "The portfolio or forecast changed. Review the latest baseline before confirming.",
          ),
        );
      if (key === cashException.key) progress.includedCash = true;
      if (key === holdingOverlap.key) progress.includedIncoming = true;
      if (key === removedException.key) progress.retainedMissing = false;
      progress.otherCash = input.otherFiEligibleLiquidMinor;
      progress.version++;
      save();
      return Promise.resolve();
    },
  };
}
