import { z } from "zod";

import {
  AcceptedCashAccountSchema,
  HoldingImportSummariesSchema,
  HoldingSchema,
} from "./index";
import { InvestmentHoldingsViewSchema } from "./investment-holdings-view";

export const HoldingsPageSchema = z
  .object({
    version: z.literal(1),
    shell: z
      .object({
        householdName: z.string().trim().min(1).max(500),
        pendingEvidenceCount: z.number().int().nonnegative(),
      })
      .strict(),
    holdings: z.array(HoldingSchema),
    investmentHoldings: InvestmentHoldingsViewSchema,
    acceptedCashAccounts: z.array(AcceptedCashAccountSchema).max(100),
    pendingImports: HoldingImportSummariesSchema,
  })
  .strict();

export type HoldingsPage = z.infer<typeof HoldingsPageSchema>;
