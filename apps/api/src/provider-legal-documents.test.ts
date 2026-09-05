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
        Promise.resolve(
          objects.has(key)
            ? { body: new Response(Uint8Array.from(objects.get(key)!)).body }
            : null,
        ),
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
function form(includeBytes = true, capture = syntheticDocumentCapture()) {
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
  it.each(["unscanned", "blocked"])(
    "keeps %s originals private and never reads object storage on download",
    async (state) => {
      const capture = syntheticDocumentCapture();
      const document = capture.documents[0]!;
      if (state === "unscanned") delete document.scan;
      else {
        document.scan!.outcome = "blocked";
        document.extraction = {
          version: 2,
          pageCount: 0,
          problem: "security_blocked",
          citations: [],
        };
      }
      const app = createApp();
      expect(
        (await app.request(`${path}/documents`, post(form(true, capture)), env))
          .status,
      ).toBe(200);
      const row = d1.sqlite
        .prepare("SELECT id, object_key FROM source_documents WHERE sha256 = ?")
        .get(document.sha256)!;
      expect(String(row.object_key)).toMatch(
        /^quarantine\/legal-entity-documents\//u,
      );
      expect(objects.get(String(row.object_key))).toEqual(
        syntheticAgreementPdf(),
      );
      const download = await app.request(
        `/api/legal-entity-documents/${String(row.id)}`,
        { method: "POST" },
        env,
      );
      expect(download.status).toBe(423);
      expect(await download.text()).toContain("security check");
      expect(vi.spyOn(env.DOCUMENTS, "get")).not.toHaveBeenCalled();
      expect(
        d1.sqlite
          .prepare(
            "SELECT outcome FROM private_document_access_events WHERE action = 'download'",
          )
          .all(),
      ).toEqual([{ outcome: "denied" }]);
      const evidence = d1.sqlite
        .prepare(
          "SELECT evidence_json FROM provider_legal_document_observations",
        )
        .get()!;
      expect(JSON.parse(String(evidence.evidence_json))).toMatchObject({
        state: "unavailable",
        problem:
          state === "unscanned" ? "scanner_unavailable" : "security_blocked",
      });
    },
  );
  it("rejects a clean scan for different bytes before storage", async () => {
    const capture = syntheticDocumentCapture();
    capture.documents[0]!.scan!.sha256 = "f".repeat(64);
    expect(
      (
        await createApp().request(
          `${path}/documents`,
          post(form(true, capture)),
          env,
        )
      ).status,
    ).toBe(400);
    expect(vi.spyOn(env.DOCUMENTS, "put")).not.toHaveBeenCalled();
  });
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
      { method: "POST" },
      env,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get("Content-Type")).toBe("application/pdf");
    expect(download.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(
      syntheticAgreementPdf(),
    );
    expect(
      d1.sqlite
        .prepare(
          "SELECT action, outcome FROM private_document_access_events ORDER BY rowid",
        )
        .all(),
    ).toEqual([
      { action: "upload", outcome: "stored" },
      { action: "download", outcome: "released" },
    ]);
    expect(
      (await app.request(`/api/legal-entity-documents/${id}`, {}, env)).status,
    ).toBe(404);
  });
  it("denies a real second household and never reads storage for unauthorized downloads", async () => {
    await createApp().request(`${path}/documents`, post(), env);
    const document = d1.sqlite
      .prepare("SELECT id FROM source_documents WHERE sha256 = ?")
      .get(syntheticDocumentCapture().documents[0]!.sha256)!;
    d1.sqlite.exec(
      "INSERT INTO users VALUES ('user_other', 'other-subject', 'other@example.test', 'Synthetic Other', '2026-09-01'); INSERT INTO households VALUES ('hh_other', 'user_other', 'Synthetic Other', 'USD', '2026-09-01');",
    );
    const app = createApp({
      verifyAccess: () =>
        Promise.resolve({
          kind: "user",
          subject: "other-subject",
          email: null,
        }),
    });
    const storage = vi.spyOn(env.DOCUMENTS, "get");
    const secured = { ...env, ENVIRONMENT: "preview" as const };
    const url = `/api/legal-entity-documents/${String(document.id)}`;
    expect((await app.request(url, { method: "POST" }, secured)).status).toBe(
      401,
    );
    expect(
      (
        await app.request(
          url,
          {
            method: "POST",
            headers: { "Cf-Access-Jwt-Assertion": "synthetic-jwt" },
          },
          secured,
        )
      ).status,
    ).toBe(404);
    expect(storage).not.toHaveBeenCalled();
    expect(
      d1.sqlite
        .prepare(
          "SELECT household_id, actor_user_id, outcome FROM private_document_access_events WHERE action = 'download'",
        )
        .all(),
    ).toEqual([
      {
        household_id: "hh_other",
        actor_user_id: "user_other",
        outcome: "denied",
      },
    ]);
  });
  it("does not release bytes when the private audit cannot be recorded", async () => {
    const app = createApp();
    await app.request(`${path}/documents`, post(), env);
    const document = d1.sqlite
      .prepare("SELECT id FROM source_documents WHERE sha256 = ?")
      .get(syntheticDocumentCapture().documents[0]!.sha256)!;
    d1.sqlite.exec(
      "CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON private_document_access_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
    );
    const response = await app.request(
      `/api/legal-entity-documents/${String(document.id)}`,
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("%PDF-");
  });
  it("denies release if a newer blocked scan arrives during the object read", async () => {
    const app = createApp();
    await app.request(`${path}/documents`, post(), env);
    const document = d1.sqlite
      .prepare("SELECT id FROM source_documents WHERE sha256 = ?")
      .get(syntheticDocumentCapture().documents[0]!.sha256)!;
    vi.spyOn(env.DOCUMENTS, "get").mockImplementationOnce(async () => {
      const blocked = syntheticDocumentCapture();
      blocked.naturalKeySha256 = "c".repeat(64);
      blocked.documents[0]!.checkedAt = "2026-09-01T12:01:00.000Z";
      blocked.documents[0]!.scan!.scannedAt = "2026-09-01T12:01:00.000Z";
      blocked.documents[0]!.scan!.outcome = "blocked";
      blocked.documents[0]!.extraction = {
        version: 2,
        pageCount: 0,
        problem: "security_blocked",
        citations: [],
      };
      expect(
        (
          await app.request(
            `${path}/documents`,
            post(form(false, blocked)),
            env,
          )
        ).status,
      ).toBe(200);
      return {
        body: new Response(syntheticAgreementPdf()).body,
      } as unknown as R2ObjectBody;
    });
    const response = await app.request(
      `/api/legal-entity-documents/${String(document.id)}`,
      { method: "POST" },
      env,
    );
    expect(response.status).toBe(423);
    expect(await response.text()).not.toContain("%PDF-");
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM private_document_access_events WHERE outcome = 'released'",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      d1.sqlite
        .prepare(
          "SELECT outcome FROM private_document_access_events WHERE action = 'download'",
        )
        .all(),
    ).toEqual([{ outcome: "denied" }]);
  });
  it("rolls back original metadata if its upload audit fails, then recovers the same bytes", async () => {
    const app = createApp();
    d1.sqlite.exec(
      "CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON private_document_access_events BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;",
    );
    expect((await app.request(`${path}/documents`, post(), env)).status).toBe(
      503,
    );
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM source_documents WHERE sha256 = ?",
        )
        .get(syntheticDocumentCapture().documents[0]!.sha256),
    ).toEqual({ count: 0 });
    d1.sqlite.exec("DROP TRIGGER synthetic_audit_failure;");
    expect((await app.request(`${path}/documents`, post(), env)).status).toBe(
      200,
    );
    expect(
      d1.sqlite
        .prepare("SELECT COUNT(*) AS count FROM private_document_access_events")
        .get(),
    ).toEqual({ count: 1 });
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
          { method: "POST", headers },
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
