import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  D1MacAgentCredentialRepository,
  D1ProviderPortfolioAgentRepository,
} from "@keel/database";
import {
  legalDocumentTestDatabase,
  syntheticAgreementPdf,
  syntheticDocumentCapture,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import { createApp } from "./app";
import { readLegalDocumentUpload } from "./provider-legal-documents";
import type { Env } from "./types";

let d1: LegalDocumentTestD1;
let env: Env;
let path: string;
let token: string;
let objects: Map<string, Uint8Array>;
beforeEach(async () => {
  d1 = legalDocumentTestDatabase();
  objects = new Map();
  env = {
    DB: d1.asD1(),
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
    CONNECTOR_CREDENTIAL_KEY: btoa("k".repeat(32))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/u, ""),
    DOCUMENTS: {
      put: vi.fn((key: string, bytes: Uint8Array) => {
        objects.set(key, Uint8Array.from(bytes));
        return Promise.resolve();
      }),
      get: vi.fn((key: string) =>
        Promise.resolve(objects.has(key) ? { body: objects.get(key) } : null),
      ),
    } as unknown as R2Bucket,
  };
  const agents = new D1ProviderPortfolioAgentRepository(d1.asD1());
  await agents.register("synthetic-access-subject", "sydecar");
  await agents.requestRun("synthetic-access-subject", "sydecar");
  const run = (await agents.lease("synthetic-access-subject", "sydecar")).run;
  if (run === null) throw new Error("Synthetic lease missing");
  path = `/api/automation/provider-holdings/sydecar/mac-agent/runs/${run.id}`;
  token = run.leaseToken;
});
afterEach(() => d1.sqlite.close());
function form(includeBytes = true) {
  const capture = syntheticDocumentCapture();
  const body = new FormData();
  body.append("capture", JSON.stringify(capture));
  if (includeBytes)
    body.append(
      capture.documents[0]?.sha256 ?? "",
      new Blob([Uint8Array.from(syntheticAgreementPdf())], {
        type: "application/pdf",
      }),
      "agreement.pdf",
    );
  return body;
}
function post(body = form()) {
  return { method: "POST", headers: { "X-Keel-Agent-Lease": token }, body };
}

describe("private provider agreement API", () => {
  it("saves verified bytes once and returns downloadable document/page evidence", async () => {
    const put = vi.spyOn(env.DOCUMENTS, "put");
    const app = createApp();
    expect((await app.request(`${path}/documents`, post(), env)).status).toBe(
      200,
    );
    expect(
      (await app.request(`${path}/documents`, post(form(false)), env)).status,
    ).toBe(200);
    expect(put).toHaveBeenCalledTimes(1);
    const manifest = await app.request(
      `${path}/document-manifest`,
      { method: "POST", headers: { "X-Keel-Agent-Lease": token } },
      env,
    );
    expect(manifest.status).toBe(200);
    const { ProviderLegalDocumentManifestSchema } =
      await import("@keel/domain/provider-legal-documents");
    const data = ProviderLegalDocumentManifestSchema.parse(
      await manifest.json(),
    );
    const id = data.captures[0]?.documents[0]?.id ?? "";
    const download = await app.request(
      `/api/legal-entity-documents/${id}`,
      {},
      env,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Type")).toBe("application/pdf");
    expect(download.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(
      syntheticAgreementPdf(),
    );
  });
  it("rejects missing, duplicate, mismatched and oversized bytes before storage", async () => {
    const put = vi.spyOn(env.DOCUMENTS, "put");
    const app = createApp();
    expect(
      (await app.request(`${path}/documents`, post(form(false)), env)).status,
    ).toBe(400);
    const bad = form();
    bad.set(
      syntheticDocumentCapture().documents[0]?.sha256 ?? "",
      new Blob(["%PDF-invalid"]),
      "agreement.pdf",
    );
    expect(
      (await app.request(`${path}/documents`, post(bad), env)).status,
    ).toBe(400);
    const duplicate = form();
    duplicate.append("capture", JSON.stringify(syntheticDocumentCapture()));
    expect(
      (await app.request(`${path}/documents`, post(duplicate), env)).status,
    ).toBe(400);
    await expect(
      readLegalDocumentUpload(
        new Request("https://keel.example/api", {
          method: "POST",
          body: form(),
          headers: { "Content-Length": "999999999" },
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(put).not.toHaveBeenCalled();
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_legal_document_observations",
        )
        .get(),
    ).toEqual({ count: 0 });
  });
  it("recovers an ambiguous private storage failure using the same reservation", async () => {
    const put = vi.spyOn(env.DOCUMENTS, "put");
    put.mockImplementationOnce((key, value) => {
      objects.set(key, Uint8Array.from(value as Uint8Array));
      return Promise.reject(new Error("synthetic lost acknowledgement"));
    });
    const app = createApp();
    const failed = await app.request(`${path}/documents`, post(), env);
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("acknowledgement");
    expect((await app.request(`${path}/documents`, post(), env)).status).toBe(
      200,
    );
    expect(objects.size).toBe(1);
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_legal_document_uploads",
        )
        .get(),
    ).toEqual({ count: 1 });
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_legal_document_observations",
        )
        .get(),
    ).toEqual({ count: 1 });
  });
  it("permits only provider-scoped machine writes, never inventory acceptance or document reads", async () => {
    const credential = await new D1MacAgentCredentialRepository(
      d1.asD1(),
    ).issueToken("synthetic-access-subject", "sydecar");
    const origin = "https://keel-agents.example.com";
    const agentEnv = {
      ...env,
      ENVIRONMENT: "preview" as const,
      MAC_AGENT_API_ORIGIN: origin,
    };
    const headers = {
      Authorization: `Bearer ${credential}`,
      "X-Keel-Agent-Lease": token,
    };
    const app = createApp();
    expect(
      (
        await app.request(
          `${origin}${path}/document-manifest`,
          { method: "POST", headers },
          agentEnv,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `${origin}${path.replace("sydecar", "tokenfolio")}/document-manifest`,
          { method: "POST", headers },
          agentEnv,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          `${origin}/api/legal-entity-documents/${crypto.randomUUID()}`,
          { headers },
          agentEnv,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          `${origin}/api/legal-entity-sources/exact-batch`,
          { method: "POST", headers },
          agentEnv,
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          `${origin}${path}/documents`,
          { method: "POST", headers, body: form() },
          agentEnv,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(
          `${path}/documents`,
          { ...post(), headers: { "X-Keel-Agent-Lease": "x".repeat(43) } },
          env,
        )
      ).status,
    ).toBe(409);
  });
});
