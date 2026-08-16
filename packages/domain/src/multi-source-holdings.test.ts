import { describe, expect, it } from "vitest";

import {
  CanonicalExposureSchema,
  HoldingImportCanonicalScopeSchema,
  HoldingImportCoverageSchema,
  InvestmentConnectionSchema,
  OwnedPositionIdentitySchema,
  OwnedPositionSnapshotSchema,
  OwnershipContainerSchema,
  PositionExposureMappingSchema,
} from "./index";

const recordedAt = "2026-08-15T20:00:00.000Z";

describe("multi-source holdings domain contract", () => {
  it("uses protected connection and container identities instead of labels", () => {
    const connection = InvestmentConnectionSchema.parse({
      id: "investment_connection_synthetic",
      householdId: "hh_demo",
      adapterType: "plaid-investments",
      protectedSourceKey: "a".repeat(64),
      institutionKey: "synthetic-brokerage",
      institutionLabel: "Synthetic Brokerage",
      lifecycleState: "active",
      credentialReference: "connector-secrets/synthetic.json.enc",
      version: 1,
      recordedAt,
    });
    const container = OwnershipContainerSchema.parse({
      id: "ownership_container_synthetic",
      householdId: "hh_demo",
      connectionId: connection.id,
      protectedAccountKey: "b".repeat(64),
      displayLabel: "Synthetic IRA",
      containerKind: "ira",
      taxTreatment: "unknown",
      version: 1,
      recordedAt,
    });

    expect(container).toMatchObject({
      connectionId: connection.id,
      containerKind: "ira",
      taxTreatment: "unknown",
    });
    expect(
      InvestmentConnectionSchema.safeParse({
        ...connection,
        protectedSourceKey: "raw-provider-item-id",
      }).success,
    ).toBe(false);
    expect(
      OwnershipContainerSchema.safeParse({
        ...container,
        protectedAccountKey: "raw-provider-account-id",
      }).success,
    ).toBe(false);
  });

  it("requires provider credentials only while a provider connection can run", () => {
    const base = {
      id: "investment_connection_synthetic",
      householdId: "hh_demo",
      adapterType: "plaid-investments" as const,
      protectedSourceKey: "a".repeat(64),
      institutionKey: "synthetic-brokerage",
      institutionLabel: "Synthetic Brokerage",
      version: 1,
      recordedAt,
    };

    expect(
      InvestmentConnectionSchema.safeParse({
        ...base,
        lifecycleState: "active",
        credentialReference: null,
      }).success,
    ).toBe(false);
    expect(
      InvestmentConnectionSchema.safeParse({
        ...base,
        lifecycleState: "disconnected",
        credentialReference: "connector-secrets/synthetic.json.enc",
      }).success,
    ).toBe(false);
    expect(
      InvestmentConnectionSchema.safeParse({
        ...base,
        lifecycleState: "disconnected",
        credentialReference: null,
      }).success,
    ).toBe(true);
  });

  it("keeps position identity, quantity scale, and unknown value explicit", () => {
    const identity = {
      id: "holding_position_ownership_synthetic",
      householdId: "hh_demo",
      containerId: "ownership_container_synthetic",
      positionId: "holding_position_synthetic",
      protectedPositionKey: "c".repeat(64),
      associationBasis: "reviewed_import",
      evidenceSha256: "d".repeat(64),
      version: 1,
      supersedesOwnershipId: null,
      acceptedAt: recordedAt,
    };
    expect(OwnedPositionIdentitySchema.safeParse(identity).success).toBe(true);
    expect(
      OwnedPositionIdentitySchema.safeParse({
        ...identity,
        associationBasis: "reviewed_legacy",
      }).success,
    ).toBe(false);

    const snapshot = {
      id: "holding_position_snapshot_synthetic",
      householdId: "hh_demo",
      positionId: "holding_position_synthetic",
      sourceImportRowId: "holding_import_row_synthetic",
      acceptedDecisionId: "holding_import_decision_synthetic",
      effectiveDate: "2026-08-15",
      observedAt: recordedAt,
      quantity: { quantityScaled: 12_345_678, quantityScale: 1_000_000 },
      valueMinor: null,
      valueState: "not_reported" as const,
      costBasisMinor: 100_000,
      currency: "USD",
    };
    expect(OwnedPositionSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(
      OwnedPositionSnapshotSchema.safeParse({
        ...snapshot,
        quantity: { quantityScaled: 12.5, quantityScale: 1_000_000 },
      }).success,
    ).toBe(false);
    expect(
      OwnedPositionSnapshotSchema.safeParse({
        ...snapshot,
        valueMinor: 0,
      }).success,
    ).toBe(false);
  });

  it("separates canonical exposure from legal position and bounds allocations", () => {
    const exposure = CanonicalExposureSchema.parse({
      id: "canonical_exposure_synthetic",
      householdId: "hh_demo",
      exposureKind: "public_instrument",
      canonicalName: "Synthetic Public Security",
      protectedIdentityKey: "e".repeat(64),
      companyId: null,
      resolutionMethod: "strong_identifier",
      evidenceSha256: "f".repeat(64),
      createdAt: recordedAt,
    });
    const mapping = {
      id: "position_exposure_mapping_synthetic",
      householdId: "hh_demo",
      positionId: "holding_position_synthetic",
      exposureId: exposure.id,
      relationshipKind: "direct" as const,
      allocationPpm: 1_000_000,
      status: "active" as const,
      decisionSource: "deterministic_policy" as const,
      decisionReference: "public-identity-v1",
      evidenceSha256: "0".repeat(64),
      effectiveAt: recordedAt,
      version: 1,
      supersedesMappingId: null,
    };

    expect(PositionExposureMappingSchema.safeParse(mapping).success).toBe(true);
    expect(
      PositionExposureMappingSchema.safeParse({
        ...mapping,
        allocationPpm: 1_000_001,
      }).success,
    ).toBe(false);
    expect(
      PositionExposureMappingSchema.safeParse({
        ...mapping,
        status: "withdrawn",
      }).success,
    ).toBe(false);
    expect(
      CanonicalExposureSchema.safeParse({
        ...exposure,
        protectedIdentityKey: null,
      }).success,
    ).toBe(false);
  });

  it("represents complete and incomplete coverage without inferring a value", () => {
    const coverage = {
      id: "holding_import_coverage_synthetic",
      householdId: "hh_demo",
      importId: "holding_import_synthetic",
      connectionId: "investment_connection_synthetic",
      containerId: "ownership_container_synthetic",
      completeness: "complete" as const,
      evidenceSha256: "1".repeat(64),
      observedAt: recordedAt,
    };

    expect(HoldingImportCoverageSchema.safeParse(coverage).success).toBe(true);
    expect(
      HoldingImportCoverageSchema.safeParse({
        ...coverage,
        completeness: "failed",
      }).success,
    ).toBe(true);
    expect(
      HoldingImportCoverageSchema.safeParse({
        ...coverage,
        completeness: "missing_means_sold",
      }).success,
    ).toBe(false);
  });

  it("requires every import row to use a declared resolved coverage container", () => {
    const scope = {
      connection: {
        mode: "existing" as const,
        connectionId: "investment_connection_synthetic",
      },
      containers: [
        {
          protectedAccountKey: "2".repeat(64),
          displayLabel: "Synthetic brokerage",
          containerKind: "brokerage" as const,
          taxTreatment: "taxable" as const,
          completeness: "partial" as const,
        },
      ],
      rows: [
        {
          sourceRowNumber: 1,
          protectedAccountKey: "2".repeat(64),
          protectedPositionKey: "3".repeat(64),
        },
      ],
    };

    expect(HoldingImportCanonicalScopeSchema.safeParse(scope).success).toBe(
      true,
    );
    expect(
      HoldingImportCanonicalScopeSchema.safeParse({
        ...scope,
        rows: [
          {
            ...scope.rows[0],
            protectedAccountKey: "4".repeat(64),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      HoldingImportCanonicalScopeSchema.safeParse({
        ...scope,
        containers: [
          {
            ...scope.containers[0],
            containerKind: "unresolved",
            completeness: "complete",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
