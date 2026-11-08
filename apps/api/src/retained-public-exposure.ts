import {
  plaidInvestmentStrongSecurityIdentifier,
  PlaidInvestmentsHoldingsResponseSchema,
} from "@keel/connectors";
import {
  D1ExposureRepository,
  type RetainedPublicExposureDocument,
  type RetainedPublicExposureEvidenceInput,
  type RetainedProviderExposureEvidenceInput,
  type RetainedStructuredAssetExposureEvidenceInput,
} from "@keel/database";

import {
  investmentCashCurrencyExposureKey,
  plaidInvestmentsExposureKey,
  plaidInvestmentsProviderSecurityExposureKey,
  plaidInvestmentsSourceKey,
} from "./investment-identity";
import type { Env } from "./types";

const MAX_RETAINED_PUBLIC_DOCUMENT_BYTES = 5 * 1_048_576;
// Explicit maintenance progresses over several requests: at most 25 MiB and
// five R2 reads in one invocation, independent of retained document history.
const MAX_RETAINED_PUBLIC_DOCUMENTS = 5;

type RetainedPublicExposureRepository = Pick<
  D1ExposureRepository,
  | "listRetainedPublicExposureDocuments"
  | "recordRetainedPublicExposureDocumentFailures"
  | "recordRetainedPublicExposureEvidence"
  | "recordRetainedProviderExposureEvidence"
  | "recordRetainedStructuredAssetExposureEvidence"
  | "reconcileAcceptedPublicExposureHistory"
>;

type RetainedDocumentExposureEvidence = {
  readonly publicEvidence: readonly RetainedPublicExposureEvidenceInput[];
  readonly providerEvidence: readonly RetainedProviderExposureEvidenceInput[];
  readonly structuredAssetEvidence: readonly RetainedStructuredAssetExposureEvidenceInput[];
};

const providerScopedSecurityTypes = new Set(["equity", "etf", "mutual fund"]);

export type RetainedPublicExposureReconciliationResult = {
  readonly documentCount: number;
  readonly skippedDocumentCount: number;
  readonly identityCount: number;
};

export interface RetainedPublicExposureReconciler {
  reconcile(
    accessSubject: string,
    importId?: string,
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
): Promise<RetainedDocumentExposureEvidence> {
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
  const sourceKey = await plaidInvestmentsSourceKey(env, response.item.item_id);
  const publicEvidence: RetainedPublicExposureEvidenceInput[] = [];
  const providerEvidence: RetainedProviderExposureEvidenceInput[] = [];
  const structuredAssetEvidence: RetainedStructuredAssetExposureEvidenceInput[] =
    [];
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
      const normalizedSecurityType = security.type?.trim().toLowerCase() ?? "";
      publicEvidence.push({
        importRowId: row.importRowId,
        resolutionStatus: "no_strong_identifier",
        evidenceSha256: document.evidenceSha256,
      });
      if (providerScopedSecurityTypes.has(normalizedSecurityType)) {
        providerEvidence.push({
          importRowId: row.importRowId,
          resolutionStatus: "scoped_identifier",
          protectedIdentityKey:
            await plaidInvestmentsProviderSecurityExposureKey(
              env,
              sourceKey,
              security.security_id,
            ),
          evidenceSha256: document.evidenceSha256,
        });
      } else {
        providerEvidence.push({
          importRowId: row.importRowId,
          resolutionStatus: "not_eligible",
          evidenceSha256: document.evidenceSha256,
        });
        if (
          normalizedSecurityType === "cash" &&
          holding.iso_currency_code === "USD" &&
          holding.unofficial_currency_code === null &&
          security.iso_currency_code === "USD" &&
          security.unofficial_currency_code === null
        ) {
          structuredAssetEvidence.push({
            importRowId: row.importRowId,
            resolutionStatus: "structured_identifier",
            identityKind: "cash_currency",
            protectedIdentityKey: await investmentCashCurrencyExposureKey(
              env,
              "USD",
            ),
            currencyCode: "USD",
            evidenceSha256: document.evidenceSha256,
          });
        } else if (normalizedSecurityType === "cryptocurrency") {
          structuredAssetEvidence.push({
            importRowId: row.importRowId,
            resolutionStatus: "structured_identifier",
            identityKind: "provider_crypto",
            protectedIdentityKey:
              await plaidInvestmentsProviderSecurityExposureKey(
                env,
                sourceKey,
                security.security_id,
              ),
            currencyCode: null,
            evidenceSha256: document.evidenceSha256,
          });
        } else {
          structuredAssetEvidence.push({
            importRowId: row.importRowId,
            resolutionStatus: "not_eligible",
            evidenceSha256: document.evidenceSha256,
          });
        }
      }
      continue;
    }
    publicEvidence.push({
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
  return { publicEvidence, providerEvidence, structuredAssetEvidence };
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
    importId?: string,
  ): Promise<RetainedPublicExposureReconciliationResult> {
    if (
      this.env.CONNECTOR_CREDENTIAL_KEY === undefined &&
      importId === undefined
    ) {
      return { documentCount: 0, skippedDocumentCount: 0, identityCount: 0 };
    }
    const documents = (
      await (importId === undefined
        ? this.repository.listRetainedPublicExposureDocuments(accessSubject)
        : this.repository.listRetainedPublicExposureDocuments(
            accessSubject,
            importId,
          ))
    ).slice(0, MAX_RETAINED_PUBLIC_DOCUMENTS);
    if (
      importId !== undefined &&
      (documents.length > 1 ||
        documents.some((document) => document.importId !== importId))
    )
      throw new Error("Source security completion exceeded its report scope.");
    if (documents.length > 0 && this.env.CONNECTOR_CREDENTIAL_KEY === undefined)
      throw new Error("Source security evidence is not configured.");
    let skippedDocumentCount = 0;
    const failedImportIds: string[] = [];
    let identityCount = 0;
    const publicEvidence: RetainedPublicExposureEvidenceInput[] = [];
    const providerEvidence: RetainedProviderExposureEvidenceInput[] = [];
    const structuredEvidence: RetainedStructuredAssetExposureEvidenceInput[] =
      [];
    for (const document of documents) {
      try {
        const evidence = await evidenceFromDocument(this.env, document);
        publicEvidence.push(...evidence.publicEvidence);
        providerEvidence.push(...evidence.providerEvidence);
        structuredEvidence.push(...evidence.structuredAssetEvidence);
        identityCount +=
          evidence.publicEvidence.filter(
            (row) => row.resolutionStatus === "strong_identifier",
          ).length +
          evidence.providerEvidence.filter(
            (row) => row.resolutionStatus === "scoped_identifier",
          ).length +
          evidence.structuredAssetEvidence.filter(
            (row) => row.resolutionStatus === "structured_identifier",
          ).length;
      } catch (error) {
        // Explicit completion retries only this report's derived evidence. A
        // failed read must remain recoverable without another financial choice.
        if (importId !== undefined) throw error;
        skippedDocumentCount += 1;
        failedImportIds.push(document.importId);
      }
    }
    if (failedImportIds.length > 0) {
      await this.repository.recordRetainedPublicExposureDocumentFailures(
        accessSubject,
        failedImportIds,
      );
    }
    // Parsing failures remain isolated to their source. Database failures must
    // surface for retry; accepted, append-only evidence makes replay safe.
    if (publicEvidence.length > 0) {
      await this.repository.recordRetainedPublicExposureEvidence(
        accessSubject,
        publicEvidence,
      );
    }
    if (providerEvidence.length > 0) {
      await this.repository.recordRetainedProviderExposureEvidence(
        accessSubject,
        providerEvidence,
      );
    }
    if (structuredEvidence.length > 0) {
      await this.repository.recordRetainedStructuredAssetExposureEvidence(
        accessSubject,
        structuredEvidence,
      );
    }
    if (importId === undefined)
      await this.repository.reconcileAcceptedPublicExposureHistory(
        accessSubject,
      );
    else
      await this.repository.reconcileAcceptedPublicExposureHistory(
        accessSubject,
        importId,
      );
    return {
      documentCount: documents.length,
      skippedDocumentCount,
      identityCount,
    };
  }
}
