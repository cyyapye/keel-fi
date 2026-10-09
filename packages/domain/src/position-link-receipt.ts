import { z } from "zod";

// Shared by the link workspace and the investment timeline without importing
// the position read model back into purchase contracts.
export const PositionLinkReceiptSchema = z.object({
  id: z.string(),
  sourcePositionId: z.string(),
  targetPositionId: z.string(),
  relationship: z.enum(["same_investment", "replaced"]),
  state: z.enum(["linked", "unlinked"]),
  useSourceValue: z.boolean(),
  companyRenamed: z.boolean().default(false),
  companyName: z.string().nullable().default(null),
  formerCompanyName: z.string().nullable().default(null),
  note: z.string(),
  acceptedAt: z.iso.datetime({ offset: true }),
});
