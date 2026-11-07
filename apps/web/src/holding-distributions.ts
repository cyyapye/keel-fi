import {
  AcceptDistributionsSchema,
  type AcceptDistributions,
} from "@keel/domain/position-purchases";
import type { DistributionReview } from "@keel/domain/investment-details";
import { decimal, scaled } from "./decimal-input";

export type DistributionEventDraft = {
  id: string;
  kind: "cash" | "in_kind";
  receivedOn: string;
  amount: string;
  security: string;
  quantity: string;
  evidence: string;
  sourceUrl: string | null;
  note: string;
};
export type DistributionDraft = {
  snapshotId: string;
  receiptId: string | null;
  realizedValueMinor: number;
  original: DistributionReview | undefined;
  events: DistributionEventDraft[];
  coverage: "complete" | "incomplete";
  throughDate: string;
  priorCarryAmount: string;
  inclusion: DistributionReview["provider"]["inclusion"];
  providerBindingStale: boolean;
};
export const distributionInclusionOptions = [
  { value: "all", label: "Already included" },
  { value: "none", label: "Not included" },
  { value: "unknown", label: "Unknown" },
  { value: "unsupported_mixed", label: "Mixed · only some included" },
] as const;
export const distributionCoverageOptions = [
  { value: "complete", label: "All received distributions recorded" },
  { value: "incomplete", label: "Only some distributions recorded" },
] as const;

export function newDistribution(): DistributionEventDraft {
  return {
    id: crypto.randomUUID(),
    kind: "cash",
    receivedOn: "",
    amount: "",
    security: "",
    quantity: "",
    evidence: "",
    sourceUrl: null,
    note: "",
  };
}
export function draftDistributions(input: {
  snapshotId: string;
  receiptId: string | null;
  realizedValueMinor: number;
  review: DistributionReview | undefined;
}): DistributionDraft {
  const review = input.review;
  const stale = Boolean(
    review &&
    (review.provider.sourceSnapshotId !== input.snapshotId ||
      review.provider.realizedValueMinor !== input.realizedValueMinor),
  );
  return {
    snapshotId: input.snapshotId,
    receiptId: input.receiptId,
    realizedValueMinor: input.realizedValueMinor,
    original: review,
    providerBindingStale: stale,
    events: review
      ? review.events.map((event) => ({
          id: event.id,
          kind: event.kind,
          receivedOn: event.receivedOn,
          amount: decimal(event.investorValueMinor, 2),
          security: event.kind === "in_kind" ? (event.securityLabel ?? "") : "",
          quantity:
            event.kind === "in_kind" ? decimal(event.quantityMicros, 6) : "",
          evidence: event.sourceLabel,
          sourceUrl: event.sourceUrl,
          note: event.note,
        }))
      : [newDistribution()],
    coverage: review?.coverage.status ?? "incomplete",
    throughDate: review?.coverage.throughDate ?? "",
    priorCarryAmount:
      review?.priorCarry.status === "known"
        ? decimal(review.priorCarry.amountMinor, 2)
        : "",
    inclusion: stale ? "unknown" : (review?.provider.inclusion ?? "unknown"),
  };
}
export function parseDistributionDraft(
  draft: DistributionDraft,
):
  | { success: true; data: AcceptDistributions }
  | { success: false; message: string } {
  for (const event of draft.events) {
    if (event.amount.trim() && !Number.isSafeInteger(scaled(event.amount, 2)))
      return {
        success: false,
        message:
          "Enter a nonnegative amount with up to two decimal places, or leave it blank if unknown.",
      };
    const quantity = scaled(event.quantity, 6);
    if (
      event.kind === "in_kind" &&
      event.quantity.trim() &&
      (!Number.isSafeInteger(quantity) || quantity! <= 0)
    )
      return {
        success: false,
        message:
          "Enter a positive share quantity, or leave it blank if unknown.",
      };
    if (!event.receivedOn)
      return {
        success: false,
        message: "Enter the date each distribution was received.",
      };
    if (!event.evidence.trim())
      return {
        success: false,
        message: "Name the evidence for each distribution.",
      };
  }
  if (!draft.throughDate)
    return {
      success: false,
      message: "Enter the actual date covered by this distribution history.",
    };
  if (
    draft.priorCarryAmount.trim() &&
    !Number.isSafeInteger(scaled(draft.priorCarryAmount, 2))
  )
    return {
      success: false,
      message:
        "Enter a nonnegative carry amount with up to two decimal places, or leave it blank if unknown.",
    };
  const result = AcceptDistributionsSchema.safeParse({
    expectedSnapshotId: draft.snapshotId,
    expectedReceiptId: draft.receiptId,
    distributionReview: {
      method: "capital_return_first_v1",
      sourceLabel: draft.original?.sourceLabel ?? "Manual distribution review",
      sourceUrl: draft.original?.sourceUrl ?? null,
      note: draft.original?.note ?? "",
      events: draft.events.map((event) => {
        const common = {
          id: event.id,
          receivedOn: event.receivedOn,
          investorValueMinor: scaled(event.amount, 2),
          sourceLabel: event.evidence,
          sourceUrl: event.sourceUrl,
          note: event.note,
        };
        return event.kind === "cash"
          ? { ...common, kind: "cash" }
          : {
              ...common,
              kind: "in_kind",
              securityLabel: event.security.trim() || null,
              quantityMicros: scaled(event.quantity, 6),
            };
      }),
      coverage: { status: draft.coverage, throughDate: draft.throughDate },
      priorCarry: draft.priorCarryAmount.trim()
        ? { status: "known", amountMinor: scaled(draft.priorCarryAmount, 2) }
        : { status: "unknown" },
      provider: {
        inclusion: draft.inclusion,
        sourceSnapshotId: draft.snapshotId,
        realizedValueMinor: draft.realizedValueMinor,
      },
    },
  });
  return result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        message:
          result.error.issues[0]?.message ?? "Review the distribution fields.",
      };
}
