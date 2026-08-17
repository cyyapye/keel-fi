import {
  plaidInvestmentStrongSecurityIdentifier,
  PlaidInvestmentsHoldingsResponseSchema,
} from "@keel/connectors";
import {
  D1ExposureRepository,
  type RetainedPublicExposureDocument,
  type RetainedPublicExposureEvidenceInput,
} from "@keel/database";

import { plaidInvestmentsExposureKey } from "./investment-identity";
import type { Env } from "./types";

const MAX_RETAINED_PUBLIC_DOCUMENT_BYTES = 5 * 1_048_576;

type RetainedPublicExposureRepository = Pick<
  D1ExposureRepository,
  | "listRetainedPublicExposureDocuments"
  | "recordRetainedPublicExposureEvidence"
  | "reconcileAcceptedPublicExposureHistory"
>;

export type RetainedPublicExposureReconciliationResult = {
  readonly documentCount: number;
  readonly skippedDocumentCount: number;
  readonly identityCount: number;
};

export interface RetainedPublicExposureReconciler {
  reconcile(
    accessSubject: string,
  ): Promise<RetainedPublicExposureReconciliationResult>;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function sha256Bytes(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedArrayBuffer(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function evidenceFromDocument(
  env: Env,
  document: RetainedPublicExposureDocument,
): Promise<readonly RetainedPublicExposureEvidenceInput[]> {
  if (
    document.byteSize <= 0 ||
    document.byteSize > MAX_RETAINED_PUBLIC_DOCUMENT_BYTES
  ) {
    throw new Error("Retained public exposure document size is invalid.");
  }
  const object = await env.DOCUMENTS.get(document.objectKey);
  if (object === null || object.size !== document.byteSize) {
    throw new Error("Retained public exposure document is unavailable.");
  }
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (
    bytes.byteLength !== document.byteSize ||
    (await sha256Bytes(bytes)) !== document.evidenceSha256
  ) {
    throw new Error("Retained public exposure document checksum changed.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
  } catch {
    throw new Error("Retained public exposure document is unreadable.");
  }
  const response = PlaidInvestmentsHoldingsResponseSchema.parse(decoded);
  const securitiesByProviderId = new Map(
    response.securities.map((security) => [security.security_id, security]),
  );
  const evidence: RetainedPublicExposureEvidenceInput[] = [];
  for (const row of document.rows) {
    const holding = response.holdings[row.sourceRowNumber - 1];
    const security =
      holding === undefined
        ? undefined
        : securitiesByProviderId.get(holding.security_id);
    if (holding === undefined || security === undefined) {
      throw new Error("Retained public exposure row provenance is invalid.");
    }
    const strongIdentifier = plaidInvestmentStrongSecurityIdentifier(security);
    if (strongIdentifier === null) {
      evidence.push({
        importRowId: row.importRowId,
        resolutionStatus: "no_strong_identifier",
        evidenceSha256: document.evidenceSha256,
      });
      continue;
    }
    evidence.push({
      importRowId: row.importRowId,
      resolutionStatus: "strong_identifier",
      identityKind: strongIdentifier.kind,
      protectedIdentityKey: await plaidInvestmentsExposureKey(
        env,
        strongIdentifier.kind,
        strongIdentifier.value,
      ),
      evidenceSha256: document.evidenceSha256,
    });
  }
  return evidence;
}

export class D1RetainedPublicExposureReconciler implements RetainedPublicExposureReconciler {
  private readonly repository: RetainedPublicExposureRepository;

  public constructor(
    private readonly env: Env,
    repository?: RetainedPublicExposureRepository,
  ) {
    this.repository = repository ?? new D1ExposureRepository(env.DB);
  }

  public async reconcile(
    accessSubject: string,
  ): Promise<RetainedPublicExposureReconciliationResult> {
    if (this.env.CONNECTOR_CREDENTIAL_KEY === undefined) {
      return { documentCount: 0, skippedDocumentCount: 0, identityCount: 0 };
    }
    const documents =
      await this.repository.listRetainedPublicExposureDocuments(accessSubject);
    let skippedDocumentCount = 0;
    let identityCount = 0;
    for (const document of documents) {
      try {
        const evidence = await evidenceFromDocument(this.env, document);
        await this.repository.recordRetainedPublicExposureEvidence(
          accessSubject,
          evidence,
        );
        identityCount += evidence.filter(
          (row) => row.resolutionStatus === "strong_identifier",
        ).length;
      } catch {
        skippedDocumentCount += 1;
      }
    }
    await this.repository.reconcileAcceptedPublicExposureHistory(accessSubject);
    return {
      documentCount: documents.length,
      skippedDocumentCount,
      identityCount,
    };
  }
}
