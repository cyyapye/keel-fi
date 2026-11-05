import type { LegalEntityRecord } from "../packages/domain/src/legal-entities";

export const familyHoldingsProfile = {
  id: "legal_entity_demo_family_holdings",
  versionId: "legal_entity_version_demo_family_holdings_v1",
  version: 1,
  recordedAt: "2026-08-30T17:00:00.000Z",
  legalName: "Demo Family Holdings LLC",
  entityType: "llc",
  relationship: "ownership_entity",
  currentOwner: "Demo Operator",
  jurisdiction: "Delaware, US",
  formedOn: "2024-03-12",
  einLastFour: "4821",
  ownershipInterestPpm: 1_000_000,
  interestStatus: "current",
  taxClassification: "Partnership",
  notes: "Synthetic entity prepared for counsel review.",
  sources: [],
} satisfies LegalEntityRecord;

export const studioProfile = {
  id: "legal_entity_demo_studio",
  versionId: "legal_entity_version_demo_studio_v1",
  version: 1,
  recordedAt: "2026-08-30T17:05:00.000Z",
  legalName: "Demo Studio LLC",
  entityType: "llc",
  relationship: "operating_entity",
  currentOwner: null,
  jurisdiction: "California, US",
  formedOn: null,
  einLastFour: null,
  ownershipInterestPpm: 650_000,
  interestStatus: "current",
  taxClassification: null,
  notes: null,
  sources: [],
} satisfies LegalEntityRecord;

export const historicalTrustProfile = {
  ...familyHoldingsProfile,
  legalName: "Demo Family Trust",
  entityType: "trust",
  currentOwner: "Demo International Family Trust Administration Company",
  jurisdiction: null,
  ownershipInterestPpm: null,
  interestStatus: "historical",
  taxClassification: null,
  einLastFour: null,
  notes: null,
} satisfies LegalEntityRecord;
