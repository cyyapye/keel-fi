import { z } from "zod";

export function manualHoldingInstrumentType(
  kind: "direct" | "spv_interest" | "fund_interest",
): string {
  return kind === "direct"
    ? "Direct private investment"
    : kind === "fund_interest"
      ? "Private fund interest"
      : "SPV interest";
}

const text = z.string().trim().min(1).max(1_000);
const id = z.string().min(1).max(200);
const money = z.number().int().safe().nonnegative().max(10_000_000_000_000);
export const ManualHoldingKindSchema = z.enum([
  "direct",
  "spv_interest",
  "fund_interest",
]);
export const ManualHoldingOwnerSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("existing"),
      containerId: id,
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("entity"),
      entityId: id,
      version: z.number().int().positive(),
    })
    .strict(),
  z.object({ mode: z.literal("new"), label: text.max(512) }).strict(),
]);
export const ManualHoldingCompanySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("unassigned") }).strict(),
  z
    .object({
      mode: z.literal("existing"),
      companyId: id,
      revision: z.string().min(1).max(100),
    })
    .strict(),
]);
export const ManualHoldingValuationSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("unknown") }).strict(),
  z
    .object({
      state: z.literal("estimated"),
      amountMinor: money,
      effectiveDate: z.iso.date(),
      carryStatus: z.enum(["before_carry", "after_carry", "unknown"]),
    })
    .strict(),
]);
export const ManualHoldingInputSchema = z
  .object({
    submissionId: z.uuid(),
    classification: z.literal("private_paper"),
    name: text,
    kind: ManualHoldingKindSchema,
    owner: ManualHoldingOwnerSchema,
    company: ManualHoldingCompanySchema,
    cashPaidMinor: money.nullable(),
    investmentDate: z.iso.date().nullable(),
    valuation: ManualHoldingValuationSchema,
  })
  .strict();
export const ManualHoldingIdentityInputSchema = z
  .object({
    submissionId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    expectedMappingIds: z
      .array(id)
      .max(500)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Mapping revisions must be unique.",
      ),
    name: text,
    kind: ManualHoldingKindSchema,
    owner: ManualHoldingOwnerSchema,
    investmentDate: z.iso.date().nullable(),
    company: z.union([
      ManualHoldingCompanySchema,
      z.object({ mode: z.literal("unchanged") }).strict(),
    ]),
  })
  .strict();
export const ManualHoldingReceiptSchema = z
  .object({
    submissionId: z.uuid(),
    positionId: id,
    snapshotId: id,
    purchaseReceiptId: id,
    identityVersion: z.number().int().positive(),
  })
  .strict();
export const ManualHoldingSubmissionSchema = z
  .object({
    receipt: ManualHoldingReceiptSchema.nullable(),
  })
  .strict();
export const ManualHoldingOptionsSchema = z
  .object({
    householdScope: id,
    containers: z
      .array(
        z
          .object({ id, label: text, version: z.number().int().positive() })
          .strict(),
      )
      .max(5_000),
    legalEntities: z
      .array(
        z
          .object({ id, label: text, version: z.number().int().positive() })
          .strict(),
      )
      .max(5_000),
    companies: z
      .array(
        z
          .object({ id, name: text, revision: z.string().min(1).max(100) })
          .strict(),
      )
      .max(5_000),
  })
  .strict();
export const ManualHoldingContextSchema = z
  .object({
    version: z.number().int().positive(),
    containerId: id,
    containerVersion: z.number().int().positive(),
    companyMappingIds: z.array(id).max(500),
    classification: z.literal("private_paper"),
  })
  .strict();
export type ManualHoldingInput = z.infer<typeof ManualHoldingInputSchema>;
export type ManualHoldingIdentityInput = z.infer<
  typeof ManualHoldingIdentityInputSchema
>;
export type ManualHoldingReceipt = z.infer<typeof ManualHoldingReceiptSchema>;
export type ManualHoldingOptions = z.infer<typeof ManualHoldingOptionsSchema>;
export type ManualHoldingContext = z.infer<typeof ManualHoldingContextSchema>;
