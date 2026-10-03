import { PurchaseDetailsSchema } from "../../packages/domain/src/position-purchases";
import { unknownInvestmentTerms } from "../../packages/domain/src/investment-details";
import { createHash } from "node:crypto";
import type { HoldingImportStageInput } from "../../packages/database/src/holding-imports";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export const renamedInvestmentImport = (
  company: string,
  revision: number,
  key = company,
): HoldingImportStageInput => ({
  provider: "angellist",
  formatVersion: 1,
  objectKey: `holding-imports/synthetic-rename-${revision}.csv`,
  sha256: digest(`rename-${revision}-${key}`),
  byteSize: 1024,
  effectiveDate: `2026-09-${String(revision).padStart(2, "0")}`,
  retrievedAt: `2026-09-${String(revision).padStart(2, "0")}T12:00:00.000Z`,
  rows: [
    {
      rowNumber: 2,
      naturalKeySha256: digest(key),
      companyOrFund: company,
      fundName: "Synthetic Circuit SPV, LP",
      investmentEntity: "Synthetic Family LLC",
      status: "Realized",
      investDate: "2024-06-10",
      investedMinor: 310_000,
      unrealizedValueMinor: 0,
      unrealizedValueState: "reported",
      realizedValueMinor: 0,
      netValueMinor: null,
      netValueState: "not_reported",
      positionKind: "spv_interest",
      dealMetadata: {
        allocationMinor: 310_000,
        instrument: "SPV interest",
        managementFeePpm: null,
        carryPpm: revision > 1 ? 175_000 : null,
      },
    },
  ],
  canonicalScope: {
    connection: {
      mode: "ensure",
      adapterType: "angellist-import",
      protectedSourceKey: digest("rename-provider"),
      institutionKey: "angellist",
      institutionLabel: "AngelList",
      lifecycleState: "pending",
      credentialReference: null,
    },
    containers: [
      {
        protectedAccountKey: digest("rename-owner"),
        displayLabel: "Synthetic Family LLC",
        containerKind: "entity",
        taxTreatment: "unknown",
        completeness: "partial",
      },
    ],
    rows: [
      {
        sourceRowNumber: 2,
        protectedAccountKey: digest("rename-owner"),
        protectedPositionKey: digest(key),
      },
    ],
  },
});

export const renamedInvestmentDetails = () =>
  PurchaseDetailsSchema.parse({
    cashCoversPosition: true,
    coversPosition: false,
    investmentTerms: unknownInvestmentTerms(),
    lots: [
      {
        id: "synthetic-paid-in",
        purchasedOn: "2024-06-10",
        shareClass: null,
        priceMicros: null,
        referencePriceMicros: null,
        grossCashMinor: 335000,
        netCapitalMinor: 310000,
        upfrontDeductionsMinor: 25000,
        feePpm: null,
        feeBasis: null,
        feeLabel: null,
        remainingSharesMicros: null,
        sharesAsOf: null,
        sourceLabel: "Synthetic executed receipt",
        sourceUrl: null,
        mark: null,
      },
    ],
  });
