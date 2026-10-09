import { z } from "zod";
import { InvestmentPositionRecordSchema } from "./position-read-model";
import { PositionLinkReceiptSchema } from "./position-link-receipt";
export { PositionLinkReceiptSchema } from "./position-link-receipt";

export const AcceptPositionLinkSchema = z
  .object({
    sourcePositionId: z.string().min(1).max(200),
    targetPositionId: z.string().min(1).max(200),
    expectedSourceSnapshotId: z.string().min(1).max(200),
    expectedTargetSnapshotId: z.string().min(1).max(200),
    expectedSourceParticipationReviewId: z.string().nullable(),
    expectedTargetParticipationReviewId: z.string().nullable(),
    expectedReviewId: z.string().min(1).max(200).nullable(),
    relationship: z.enum(["same_investment", "replaced"]),
    state: z.enum(["linked", "unlinked"]),
    useSourceValue: z.boolean(),
    companyRenamed: z.boolean().default(false),
    note: z.string().trim().max(1000).default(""),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.sourcePositionId === input.targetPositionId)
      ctx.addIssue({
        code: "custom",
        message: "Choose two different records.",
      });
    if (input.companyRenamed && input.relationship !== "same_investment")
      ctx.addIssue({
        code: "custom",
        message: "A company rename must be the same investment.",
      });
    if (input.relationship === "replaced" && input.useSourceValue)
      ctx.addIssue({
        code: "custom",
        message: "A replaced investment cannot provide the current value.",
      });
  });
export const PositionLinkWorkspaceSchema = z.object({
  positions: z.array(
    InvestmentPositionRecordSchema.extend({
      ownershipContainerId: z.string().optional(),
      sourceProvider: z.enum(["angellist", "sydecar", "tokenfolio"]).optional(),
      reviewedHistory: z.boolean().optional(),
    }),
  ),
  links: z.array(PositionLinkReceiptSchema),
});
export type AcceptPositionLink = z.input<typeof AcceptPositionLinkSchema>;
export type PositionLinkReceipt = z.infer<typeof PositionLinkReceiptSchema>;
export type PositionLinkWorkspace = z.infer<typeof PositionLinkWorkspaceSchema>;
