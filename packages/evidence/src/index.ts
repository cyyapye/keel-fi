import { IsoDateSchema, IsoTimestampSchema } from "@keel/domain";
import { z } from "zod";

export const SourceConfidenceSchema = z.object({
  sourceType: z.enum([
    "administrator_statement",
    "company_announcement",
    "regulatory_filing",
    "email",
    "manual_document",
  ]),
  confidencePpm: z.number().int().min(0).max(1_000_000),
  rationale: z.string().min(1),
});

export const ProposedChangeSchema = z.object({
  field: z.string().min(1),
  priorValueJson: z.string(),
  replacementValueJson: z.string(),
});

export const EvidenceEventSchema = z.object({
  id: z.string().min(1),
  householdId: z.string().min(1),
  companyId: z.string().min(1).nullable(),
  sourceDocumentId: z.string().min(1).nullable(),
  eventType: z.string().min(1),
  effectiveDate: IsoDateSchema,
  detectedAt: IsoTimestampSchema,
  retrievedAt: IsoTimestampSchema,
  status: z.enum(["pending_review", "accepted", "rejected", "scenario_only"]),
  confidencePpm: z.number().int().min(0).max(1_000_000),
  proposedChanges: z.array(ProposedChangeSchema).min(1),
});

export const ReviewInputSchema = z.object({
  decision: z.enum(["accepted", "rejected", "scenario_only"]),
  rationale: z.string().trim().min(3).max(1_000),
});

export type ReviewInput = z.infer<typeof ReviewInputSchema>;

const allowedTransitions: Record<
  string,
  ReadonlySet<ReviewInput["decision"]>
> = {
  pending_review: new Set(["accepted", "rejected", "scenario_only"]),
};

export function assertReviewTransition(
  currentStatus: string,
  decision: ReviewInput["decision"],
): void {
  if (!allowedTransitions[currentStatus]?.has(decision)) {
    throw new Error(
      `Evidence event cannot transition from ${currentStatus} to ${decision}.`,
    );
  }
}
