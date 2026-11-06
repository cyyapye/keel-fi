import type { LegalEntitySourceSummary } from "../packages/domain/src/legal-entities";
import type { LegalDocumentScan } from "../packages/domain/src/provider-legal-documents";

export function blockedAgreementSource(
  index: number,
  name: string,
  finding?: {
    reason: "encrypted" | "scan_limit" | "malware_signature";
    signature: string;
  },
  incomplete = false,
): LegalEntitySourceSummary {
  const sha256 = index.toString(16).repeat(64);
  const scan: LegalDocumentScan = {
    version: 1,
    outcome: "blocked",
    sha256,
    engineVersion: "1.5.3",
    databaseVersion: 28000,
    databaseUpdatedAt: "2026-09-01T12:00:00.000Z",
    scannedAt: "2026-09-01T12:00:00.000Z",
  };
  return {
    source: {
      kind: "holding_position",
      id: `position_demo_security_${index.toString()}`,
    },
    sourceDisplayName: name,
    sourceLabel: "Sydecar agreement",
    sourceAsOf: "2026-09-01",
    currentOwner: null,
    currentDecisionId: null,
    suggestedEntityType: null,
    relationship: "investment_vehicle",
    interestStatus: "current",
    financials: null,
    openedOn: null,
    legalEntityNameEvidence: {
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem: incomplete ? "scanner_unavailable" : "security_blocked",
      documents: [
        {
          id: `${index.toString().repeat(8)}-1111-4111-8111-111111111111`,
          fileName: `demo-${index.toString()}-agreement.pdf`,
          sha256,
          page: null,
          quote: null,
          provider: "sydecar",
          ...(incomplete
            ? {}
            : {
                scan:
                  finding === undefined
                    ? scan
                    : { ...scan, version: 2, findings: [finding] },
              }),
        },
      ],
    },
  };
}
