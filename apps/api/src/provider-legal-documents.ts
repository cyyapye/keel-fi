import {
  D1ProviderLegalDocumentRepository,
  D1ProviderPortfolioAgentRepository,
  ProviderLegalDocumentError,
  ProviderPortfolioAgentRepositoryError,
} from "@keel/database";
import {
  MAX_LEGAL_DOCUMENT_BYTES,
  MAX_LEGAL_DOCUMENT_POSITION_BYTES,
  ProviderLegalDocumentCaptureSchema,
  type ProviderLegalDocumentCapture,
} from "@keel/domain/provider-legal-documents";
import type { Hono } from "hono";
import { z } from "zod";

import type { AppEnvironment } from "./app";
import {
  providerTemplateInvestmentsSourceKey,
  providerTemplateOwnershipContainerKey,
  providerTemplatePositionKey,
} from "./investment-identity";

const MAX_BODY_BYTES = MAX_LEGAL_DOCUMENT_POSITION_BYTES + 128 * 1024;
export class LegalDocumentUploadError extends Error {
  public constructor(public readonly status: 400 | 413) {
    super("Invalid private agreement upload.");
  }
}

async function digest(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(result)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function readLegalDocumentUpload(request: Request): Promise<{
  capture: ProviderLegalDocumentCapture;
  files: Map<string, Uint8Array>;
}> {
  if (
    !request.headers.get("Content-Type")?.startsWith("multipart/form-data;") ||
    request.body === null
  )
    throw new LegalDocumentUploadError(400);
  const length = request.headers.get("Content-Length");
  if (
    length !== null &&
    (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)
  )
    throw new LegalDocumentUploadError(413);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new LegalDocumentUploadError(413);
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => {
    body.set(chunk, offset);
    offset += chunk.length;
  });
  let form: FormData;
  try {
    form = await new Request(request, { body }).formData();
  } catch {
    throw new LegalDocumentUploadError(400);
  }
  const metadata = form.getAll("capture");
  if (
    metadata.length !== 1 ||
    typeof metadata[0] !== "string" ||
    metadata[0].length > 96 * 1024
  )
    throw new LegalDocumentUploadError(400);
  let capture: ProviderLegalDocumentCapture;
  try {
    capture = ProviderLegalDocumentCaptureSchema.parse(JSON.parse(metadata[0]));
    if (
      capture.documents.some(
        (document) =>
          document.scan !== undefined &&
          Date.parse(document.scan.scannedAt) > Date.now() + 60_000,
      )
    )
      throw new Error("scan time");
  } catch {
    throw new LegalDocumentUploadError(400);
  }
  const files = new Map<string, Uint8Array>();
  for (const [key, value] of form.entries()) {
    if (key === "capture") continue;
    const expected = capture.documents.find(
      (document) => document.sha256 === key,
    );
    if (
      typeof value === "string" ||
      expected === undefined ||
      files.has(key) ||
      value.size !== expected.byteSize ||
      value.size > MAX_LEGAL_DOCUMENT_BYTES
    )
      throw new LegalDocumentUploadError(400);
    const bytes = new Uint8Array(await value.arrayBuffer());
    if (
      new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-" ||
      (await digest(bytes)) !== key
    )
      throw new LegalDocumentUploadError(400);
    files.set(key, bytes);
  }
  return { capture, files };
}

export function registerProviderLegalDocumentRoutes(
  app: Hono<AppEnvironment>,
): void {
  app.post(
    "/api/legal-entity-documents/:documentId/recheck",
    async (context) => {
      const id = z.uuid().safeParse(context.req.param("documentId"));
      const input = z
        .object({ provider: z.enum(["sydecar", "tokenfolio"]).optional() })
        .strict()
        .safeParse(await context.req.json().catch(() => null));
      if (!id.success) return context.notFound();
      if (!input.success)
        return context.json(
          { error: "Choose a saved agreement to recheck." },
          400,
        );
      const subject = context.get("identity").subject;
      try {
        const documents = new D1ProviderLegalDocumentRepository(context.env.DB);
        const provider = await documents.recheckProvider(
          subject,
          id.data,
          input.data.provider,
        );
        const agents = new D1ProviderPortfolioAgentRepository(context.env.DB);
        return context.json(
          await agents.requestRun(subject, provider, id.data),
          202,
          {
            "Cache-Control": "private, no-store",
          },
        );
      } catch (error) {
        if (error instanceof ProviderLegalDocumentError)
          return context.notFound();
        const busy =
          error instanceof ProviderPortfolioAgentRepositoryError &&
          error.code === "run_in_progress";
        return context.json(
          {
            error: busy
              ? "A source update is already queued or running. Wait for it to finish, then recheck this agreement."
              : "The agreement check could not be queued. Check the source's update setup, then try again.",
          },
          busy ? 409 : 503,
          { "Cache-Control": "private, no-store" },
        );
      }
    },
  );
  const runPath =
    "/api/automation/provider-holdings/:provider/mac-agent/runs/:runId";
  for (const operation of ["document-manifest", "documents"] as const) {
    app.post(`${runPath}/${operation}`, async (context) => {
      const provider = z
        .enum(["tokenfolio", "sydecar"])
        .safeParse(context.req.param("provider"));
      const runId = z.string().uuid().safeParse(context.req.param("runId"));
      const token = context.req.header("X-Keel-Agent-Lease") ?? "";
      if (!provider.success || !runId.success)
        return context.json({ error: "Provider run not found." }, 404);
      if (!/^[A-Za-z0-9_-]{43}$/u.test(token))
        return context.json(
          { error: "This run lease is no longer valid." },
          409,
        );
      const repository = new D1ProviderLegalDocumentRepository(context.env.DB);
      const subject = context.get("identity").subject;
      try {
        const lease = await repository.lease(
          subject,
          provider.data,
          runId.data,
          token,
        );
        if (operation === "document-manifest")
          return context.json(await repository.manifest(lease), 200, {
            "Cache-Control": "private, no-store",
          });
        const { capture, files } = await readLegalDocumentUpload(
          context.req.raw,
        );
        const sourceKey = await providerTemplateInvestmentsSourceKey(
          context.env,
          subject,
          provider.data,
        );
        const containerKey = await providerTemplateOwnershipContainerKey(
          context.env,
          sourceKey,
          capture.ownershipLabel,
          provider.data,
        );
        const positionKey = await providerTemplatePositionKey(
          context.env,
          containerKey,
          capture.naturalKeySha256,
          provider.data,
        );
        const known = await repository.knownDocuments(
          lease.householdId,
          capture.documents.map((document) => document.sha256),
        );
        if (
          capture.documents.some(
            (document) =>
              !files.has(document.sha256) &&
              !known.some(
                (item) =>
                  item.sha256 === document.sha256 &&
                  item.byte_size === document.byteSize &&
                  item.content_type === "application/pdf",
              ),
          )
        )
          throw new LegalDocumentUploadError(400);
        const objects: { sha256: string; objectKey: string }[] = [];
        await repository.reserveUploads(
          lease,
          capture.documents.filter(
            (document) =>
              !known.some((item) => item.sha256 === document.sha256),
          ),
        );
        for (const [hash, bytes] of files) {
          if (known.some((document) => document.sha256 === hash)) continue;
          // No original filename, provider URL, or bearer query in the key. A
          // failed D1 commit leaves an inert private object safe for retry.
          const objectKey = `quarantine/legal-entity-documents/${lease.householdId}/${hash}.pdf`;
          await context.env.DOCUMENTS.put(objectKey, bytes, {
            httpMetadata: { contentType: "application/pdf" },
          });
          objects.push({ sha256: hash, objectKey });
        }
        await repository.record(lease, positionKey, capture, objects);
        return context.json({ status: "recorded" }, 200, {
          "Cache-Control": "private, no-store",
        });
      } catch (error) {
        const status =
          error instanceof LegalDocumentUploadError
            ? error.status
            : error instanceof ProviderLegalDocumentError
              ? 409
              : 503;
        return context.json(
          {
            error:
              status === 409
                ? "This document capture is stale or conflicts with a saved capture."
                : status === 503
                  ? "The agreement could not be saved. Queue another source update to retry."
                  : "Choose a valid, size-limited agreement capture.",
          },
          status,
          { "Cache-Control": "private, no-store" },
        );
      }
    });
  }

  // Downloads create private access history. Keep that explicit write off GET
  // and the inventory's projection-only read path.
  app.post("/api/legal-entity-documents/:documentId", async (context) => {
    if (!z.string().uuid().safeParse(context.req.param("documentId")).success)
      return context.notFound();
    const repository = new D1ProviderLegalDocumentRepository(context.env.DB);
    const subject = context.get("identity").subject;
    const documentId = context.req.param("documentId");
    const locked = () =>
      context.json(
        {
          error:
            "This agreement has not passed its security check. Recheck the agreement before downloading.",
        },
        423,
        { "Cache-Control": "private, no-store" },
      );
    try {
      const document = await repository.document(subject, documentId);
      if (document.scan_outcome !== "clean") {
        await repository.auditDownload(subject, documentId, "denied");
        return locked();
      }
      const object = await context.env.DOCUMENTS.get(document.object_key);
      if (object === null) {
        await repository.auditDownload(subject, documentId, "unavailable");
        return context.json(
          { error: "This private agreement is unavailable." },
          404,
        );
      }
      // Fail closed if the audit write fails: never release unaudited bytes.
      try {
        if (
          (await repository.auditDownload(subject, documentId, "released")) !==
          "released"
        ) {
          await object.body.cancel();
          return locked();
        }
      } catch (error) {
        await object.body.cancel().catch(() => undefined);
        throw error;
      }
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="agreement.pdf"',
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox",
        },
      });
    } catch (error) {
      if (error instanceof ProviderLegalDocumentError) {
        await repository
          .auditDownload(subject, documentId, "denied")
          .catch(() => undefined);
      }
      return error instanceof ProviderLegalDocumentError
        ? context.notFound()
        : context.json(
            { error: "The private agreement could not be loaded." },
            503,
          );
    }
  });
}
