import type { AngelListInvestmentCsvRow } from "@keel/connectors";
import {
  HoldingImportCanonicalScopeSchema,
  type HoldingImportCanonicalScope,
} from "@keel/domain";

import {
  angelListInvestmentsSourceKey,
  angelListOwnershipContainerKey,
  angelListPositionKey,
} from "./investment-identity";
import type { Env } from "./types";

function angelListContainerKind(ownershipLabel: string): "trust" | "entity" {
  return ownershipLabel.toLowerCase().includes("trust") ? "trust" : "entity";
}

export async function buildAngelListCanonicalScope(input: {
  env: Env;
  accessSubject: string;
  rows: readonly AngelListInvestmentCsvRow[];
}): Promise<HoldingImportCanonicalScope> {
  const sourceKey = await angelListInvestmentsSourceKey(
    input.env,
    input.accessSubject,
  );
  const ownershipLabels = [
    ...new Set(input.rows.map((row) => row.investmentEntity.trim())),
  ];
  const containers = await Promise.all(
    ownershipLabels.map(async (displayLabel) => ({
      protectedAccountKey: await angelListOwnershipContainerKey(
        input.env,
        sourceKey,
        displayLabel,
      ),
      displayLabel,
      containerKind: angelListContainerKind(displayLabel),
      taxTreatment: "unknown" as const,
      completeness: "complete" as const,
    })),
  );
  const containersByLabel = new Map(
    containers.map((container) => [container.displayLabel, container]),
  );
  const rows = await Promise.all(
    input.rows.map(async (row) => {
      const container = containersByLabel.get(row.investmentEntity.trim());
      if (container === undefined) {
        throw new Error("AngelList ownership container could not be resolved.");
      }
      return {
        sourceRowNumber: row.rowNumber,
        protectedAccountKey: container.protectedAccountKey,
        protectedPositionKey: await angelListPositionKey(
          input.env,
          container.protectedAccountKey,
          row.naturalKeySha256,
        ),
      };
    }),
  );

  return HoldingImportCanonicalScopeSchema.parse({
    connection: {
      mode: "ensure",
      adapterType: "angellist-import",
      protectedSourceKey: sourceKey,
      institutionKey: "angellist",
      institutionLabel: "AngelList",
      lifecycleState: "pending",
      credentialReference: null,
    },
    containers,
    rows,
  });
}
