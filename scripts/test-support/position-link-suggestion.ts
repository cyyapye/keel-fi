import { InvestmentPositionRecordSchema } from "../../packages/domain/src/position-read-model";
import { InvestmentCompanyReceiptSchema } from "../../packages/domain/src/investment-review";
import { PurchaseReceiptSchema } from "../../packages/domain/src/position-purchases";
import { renamedInvestmentDetails } from "./renamed-investments";

// Synthetic domain records shared by suggestion policy tests and browser wiring.
export function positionLinkSuggestionFixture() {
  const positions = ["Synthetic Circuit Labs", "Synthetic Circuit Works"].map(
    (name, index) =>
      InvestmentPositionRecordSchema.parse({
        id: `synthetic-rename-${index}`,
        legalVehicleName: "Synthetic Circuit SPV, LP",
        ownerLabel: "Synthetic Family LLC",
        reportedExposureName: name,
        kind: "spv_interest",
        openedOn: "2024-06-10",
        reviewStatus: "accepted",
        acceptedAt: "2026-09-01T12:00:00.000Z",
        ownershipVersion: 1,
        ownershipBasis: "provider_provenance",
        legalEntityNameEvidence: {
          state: "provider_reported",
          legalName: "Synthetic Circuit SPV, LP",
          sourceField: "Fund Name",
        },
        source: {
          label: "AngelList",
          effectiveDate: `2026-09-0${index + 1}`,
          retrievedAt: `2026-09-0${index + 1}T12:00:00.000Z`,
          freshness: "current",
        },
        snapshot: {
          id: `synthetic-snapshot-${index}`,
          fingerprint: "a".repeat(64),
          observedAt: `2026-09-0${index + 1}T12:00:00.000Z`,
          providerStatus: "realized",
          investedMinor: 310000,
          allocationMinor: 310000,
          unrealizedValue: { state: "reported", minor: 0 },
          realizedValueMinor: 0,
          netValue: { state: "not_reported", minor: null },
          instrumentType: "SPV interest",
          currency: "USD",
          quantityMicros: null,
          ticker: null,
          costBasisMinor: null,
        },
        reportedEconomicsTerms: index
          ? {
              managementFeePpm: null,
              carryPpm: 175000,
              sourceLabel: "AngelList",
              observedAt: "2026-09-02T12:00:00.000Z",
            }
          : null,
        companyReview: InvestmentCompanyReceiptSchema.parse({
          requestId: crypto.randomUUID(),
          expectedSnapshotId: `synthetic-snapshot-${index}`,
          expectedEvidenceRevision: "a".repeat(64),
          expectedMappingIds: [],
          company: { mode: "existing", companyId: "synthetic-circuit-company" },
          basis: "user_confirmed",
          citation: null,
          reason: null,
          positionId: `synthetic-rename-${index}`,
          companyId: "synthetic-circuit-company",
          companyName: "Synthetic Circuit Labs",
          mappingId: `synthetic-mapping-${index}`,
          recordedAt: "2026-09-03T12:00:00.000Z",
          sourceDocument: null,
        }),
      }),
  );
  positions[0]!.purchaseReceipt = PurchaseReceiptSchema.parse({
    id: "synthetic-original-contribution",
    positionId: positions[0]!.id,
    snapshotId: positions[0]!.snapshot.id,
    currency: "USD",
    details: renamedInvestmentDetails(),
    acceptedAt: "2026-09-01T12:00:00.000Z",
  });
  const availablePositions = positions.map((p) => ({
    ...p,
    ownershipContainerId: "synthetic-account",
  }));
  const unrelatedPositions = Array.from({ length: 120 }, (_, index) => ({
    ...availablePositions[0]!,
    id: `synthetic-unrelated-${index}`,
    ownershipContainerId: `synthetic-other-account-${index}`,
  }));
  return { positions, availablePositions, unrelatedPositions };
}
