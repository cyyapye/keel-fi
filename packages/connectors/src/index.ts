import { IsoTimestampSchema } from "@keel/domain";
import { z } from "zod";

export const ConnectorTypeSchema = z.enum([
  "sec-edgar",
  "company-rss",
  "email-import",
  "manual-document",
]);

export const IngestionMessageSchema = z.object({
  messageId: z.uuid(),
  connectorAccountId: z.string().min(1),
  householdId: z.string().min(1),
  connectorType: ConnectorTypeSchema,
  requestedAt: IsoTimestampSchema,
  cursor: z.string().max(2_048).nullable(),
});

export const SourceDocumentMetadataSchema = z.object({
  householdId: z.string().min(1),
  sourceLabel: z.string().min(1),
  fileName: z.string().min(1).max(255),
  contentType: z.enum([
    "application/pdf",
    "text/plain",
    "text/html",
    "application/json",
    "application/xml",
    "application/rss+xml",
  ]),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt: IsoTimestampSchema,
  effectiveDate: z.iso.date().nullable(),
});

export const EvidenceProposalSchema = z.object({
  eventType: z.string().min(1),
  companyId: z.string().min(1).nullable(),
  headline: z.string().min(1).max(500),
  effectiveDate: z.iso.date(),
  retrievedAt: IsoTimestampSchema,
  confidencePpm: z.number().int().min(0).max(1_000_000),
  priorValueJson: z.string(),
  replacementValueJson: z.string(),
  provenance: z.string().min(1),
});

export type IngestionMessage = z.infer<typeof IngestionMessageSchema>;
export type EvidenceProposal = z.infer<typeof EvidenceProposalSchema>;
export type SourceDocumentMetadata = z.infer<
  typeof SourceDocumentMetadataSchema
>;

export interface ConnectorContext {
  readonly signal: AbortSignal;
  putPrivateDocument(
    metadata: SourceDocumentMetadata,
    contents: ReadableStream,
  ): Promise<{ sourceDocumentId: string }>;
}

export interface Connector {
  readonly type: z.infer<typeof ConnectorTypeSchema>;
  sync(
    message: IngestionMessage,
    context: ConnectorContext,
  ): Promise<readonly EvidenceProposal[]>;
}

export interface PrivateDocumentStore {
  put(
    metadata: SourceDocumentMetadata,
    contents: ReadableStream,
  ): Promise<{ objectKey: string }>;
  createReadUrl(objectKey: string, expiresInSeconds: number): Promise<URL>;
}

export function assertShortLivedDocumentUrl(expiresInSeconds: number): void {
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > 300
  ) {
    throw new Error("Document URLs must expire within five minutes.");
  }
}
