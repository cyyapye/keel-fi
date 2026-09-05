import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  legalDocumentTestDatabase,
  syntheticDocumentCapture,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import { D1ProviderPortfolioAgentRepository } from "./provider-portfolio-agent";
import {
  D1ProviderLegalDocumentRepository,
  legalNameEvidenceFromDocuments,
  type LegalDocumentLease,
} from "./provider-legal-documents";

let d1: LegalDocumentTestD1;
let now: Date;
let repository: D1ProviderLegalDocumentRepository;
let lease: LegalDocumentLease;
let token: string;
beforeEach(async () => {
  d1 = legalDocumentTestDatabase();
  now = new Date("2026-09-01T12:00:00.000Z");
  const agents = new D1ProviderPortfolioAgentRepository(d1.asD1(), () => now);
  await agents.register("synthetic-access-subject", "sydecar");
  await agents.requestRun("synthetic-access-subject", "sydecar");
  const leased = await agents.lease("synthetic-access-subject", "sydecar");
  if (leased.run === null) throw new Error("Synthetic lease missing");
  token = leased.run.leaseToken;
  repository = new D1ProviderLegalDocumentRepository(d1.asD1(), () => now);
  lease = await repository.lease(
    "synthetic-access-subject",
    "sydecar",
    leased.run.id,
    token,
  );
});
afterEach(() => d1.sqlite.close());
const digest = (index: number) => index.toString(16).padStart(64, "0");
function captureObjects() {
  return syntheticDocumentCapture().documents.map((document) => ({
    sha256: document.sha256,
    objectKey: `legal-entity-documents/hh_demo/${document.sha256}.pdf`,
  }));
}

describe("provider agreement evidence repository", () => {
  it("recovers quarantine and never lets an older clean scan undo a newer block", async () => {
    const clean = syntheticDocumentCapture();
    const unscanned = structuredClone(clean);
    delete unscanned.documents[0]!.scan;
    await repository.record(
      lease,
      digest(1),
      { ...unscanned, naturalKeySha256: digest(1) },
      captureObjects(),
    );
    const id = (await repository.manifest(lease)).captures[0]!.documents[0]!.id;
    expect(
      (await repository.document("synthetic-access-subject", id)).scan_outcome,
    ).toBeNull();
    await repository.record(
      lease,
      digest(2),
      { ...clean, naturalKeySha256: digest(2) },
      [],
    );
    expect(
      (await repository.document("synthetic-access-subject", id)).scan_outcome,
    ).toBe("clean");
    const blocked = structuredClone(clean);
    blocked.documents[0]!.checkedAt = "2026-09-01T12:01:00.000Z";
    blocked.documents[0]!.scan!.scannedAt = "2026-09-01T12:01:00.000Z";
    blocked.documents[0]!.scan!.outcome = "blocked";
    blocked.documents[0]!.extraction = {
      version: 2,
      pageCount: 0,
      problem: "security_blocked",
      citations: [],
    };
    await repository.record(
      lease,
      digest(3),
      { ...blocked, naturalKeySha256: digest(3) },
      [],
    );
    await repository.record(
      lease,
      digest(4),
      { ...clean, naturalKeySha256: digest(4) },
      [],
    );
    expect(
      (await repository.document("synthetic-access-subject", id)).scan_outcome,
    ).toBe("blocked");
    expect(() =>
      d1.sqlite.exec(
        "UPDATE private_document_access_events SET outcome = 'deleted'",
      ),
    ).toThrow("append only");
    expect(() =>
      d1.sqlite.exec("DELETE FROM private_document_access_events"),
    ).toThrow("append only");
    expect(
      d1.sqlite
        .prepare("SELECT COUNT(*) AS count FROM source_documents WHERE id = ?")
        .get(id),
    ).toEqual({ count: 1 });
  });
  it("saves private evidence idempotently without accepting an entity or holding", async () => {
    const entitiesBefore = d1.sqlite
      .prepare("SELECT * FROM legal_entities")
      .all();
    const positionsBefore = d1.sqlite
      .prepare("SELECT * FROM holding_positions")
      .all();
    const capture = syntheticDocumentCapture();
    await repository.reserveUploads(lease, capture.documents);
    await Promise.all([
      repository.record(lease, digest(1), capture, captureObjects()),
      repository.record(lease, digest(1), capture, captureObjects()),
    ]);
    const manifest = await repository.manifest(lease);
    expect(manifest.captures).toHaveLength(1);
    expect(manifest.captures[0]?.documents[0]).toMatchObject({
      fileName: "synthetic-agreement.pdf",
      extraction: { citations: [{ page: 1 }] },
    });
    for (const table of [
      "provider_legal_document_observations",
      "provider_legal_document_latest",
      "provider_legal_document_uploads",
    ])
      expect(
        d1.sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get(),
      ).toEqual({ count: 1 });
    expect(d1.sqlite.prepare("SELECT * FROM legal_entities").all()).toEqual(
      entitiesBefore,
    );
    expect(d1.sqlite.prepare("SELECT * FROM holding_positions").all()).toEqual(
      positionsBefore,
    );
    expect(() =>
      d1.sqlite.exec(
        "UPDATE provider_legal_document_observations SET evidence_json = '{}'",
      ),
    ).toThrow("append only");
    expect(() =>
      d1.sqlite.exec("DELETE FROM provider_legal_document_observations"),
    ).toThrow("append only");
    await expect(
      repository.record(
        lease,
        digest(1),
        { ...capture, problem: "inaccessible" },
        [],
      ),
    ).rejects.toThrow("capture_conflict");
  });
  it("rejects wrong household, provider, token, expired and terminal leases", async () => {
    await expect(
      repository.lease("other-subject", "sydecar", lease.runId, token),
    ).rejects.toThrow("lease_invalid");
    await expect(
      repository.lease(
        "synthetic-access-subject",
        "tokenfolio",
        lease.runId,
        token,
      ),
    ).rejects.toThrow("lease_invalid");
    await expect(
      repository.lease(
        "synthetic-access-subject",
        "sydecar",
        lease.runId,
        "z".repeat(43),
      ),
    ).rejects.toThrow("lease_invalid");
    now = new Date(now.getTime() + 4 * 60_000);
    await repository.lease(
      "synthetic-access-subject",
      "sydecar",
      lease.runId,
      token,
    );
    now = new Date(now.getTime() + 6 * 60_000);
    await expect(
      repository.lease(
        "synthetic-access-subject",
        "sydecar",
        lease.runId,
        token,
      ),
    ).rejects.toThrow("lease_invalid");
  });
  it("keeps newer evidence when an older projection update is replayed", async () => {
    await repository.record(
      lease,
      digest(1),
      syntheticDocumentCapture(),
      captureObjects(),
    );
    const prior = d1.sqlite
      .prepare("SELECT observation_id FROM provider_legal_document_latest")
      .get();
    d1.sqlite
      .prepare(
        "UPDATE provider_portfolio_runs SET status = 'failed', lease_token_sha256 = NULL, lease_expires_at = NULL, error_code = 'upload_failed', finished_at = ? WHERE id = ?",
      )
      .run(now.toISOString(), lease.runId);
    now = new Date("2026-09-01T12:01:00.000Z");
    const agents = new D1ProviderPortfolioAgentRepository(d1.asD1(), () => now);
    await agents.requestRun("synthetic-access-subject", "sydecar");
    const next = (await agents.lease("synthetic-access-subject", "sydecar"))
      .run;
    if (next === null) throw new Error("Synthetic lease missing");
    const nextLease = await repository.lease(
      "synthetic-access-subject",
      "sydecar",
      next.id,
      next.leaseToken,
    );
    await repository.record(
      nextLease,
      digest(1),
      {
        ...syntheticDocumentCapture(),
        problem: "missing",
        documents: [],
      },
      [],
    );
    const upsert = d1.queries.find((sql) =>
      sql.includes("INSERT INTO provider_legal_document_latest"),
    );
    if (upsert === undefined || typeof prior?.observation_id !== "string")
      throw new Error("Synthetic projection missing");
    d1.sqlite.prepare(upsert).run(prior.observation_id);
    expect((await repository.manifest(nextLease)).captures[0]).toMatchObject({
      problem: "missing",
      documents: [],
    });
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_legal_document_observations",
        )
        .get(),
    ).toEqual({ count: 2 });
  });
  it("caps renewal at thirty minutes and fences a lease lost before commit", async () => {
    const capture = syntheticDocumentCapture();
    for (let minute = 4; minute < 30; minute += 4) {
      now = new Date(
        `2026-09-01T12:${minute.toString().padStart(2, "0")}:00.000Z`,
      );
      await repository.lease(
        "synthetic-access-subject",
        "sydecar",
        lease.runId,
        token,
      );
    }
    expect(
      d1.sqlite
        .prepare(
          "SELECT lease_expires_at FROM provider_portfolio_runs WHERE id = ?",
        )
        .get(lease.runId),
    ).toEqual({ lease_expires_at: "2026-09-01T12:30:00.000Z" });
    d1.beforeBatch = () => {
      d1.sqlite
        .prepare(
          "UPDATE provider_portfolio_runs SET status = 'failed', lease_token_sha256 = NULL, lease_expires_at = NULL, error_code = 'unexpected_failure', finished_at = ? WHERE id = ?",
        )
        .run(now.toISOString(), lease.runId);
    };
    await expect(
      repository.record(lease, digest(1), capture, captureObjects()),
    ).rejects.toThrow("lease_invalid");
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_legal_document_observations",
        )
        .get(),
    ).toEqual({ count: 0 });
    await expect(
      repository.lease(
        "synthetic-access-subject",
        "sydecar",
        lease.runId,
        token,
      ),
    ).rejects.toThrow("lease_invalid");
  });
  it("reserves a fixed upload budget atomically, including retries after storage failure", async () => {
    const documents = Array.from({ length: 24 }, (_, index) => ({
      sha256: digest(index + 1),
      byteSize: 100,
    }));
    await repository.reserveUploads(lease, documents);
    await repository.reserveUploads(lease, documents);
    await expect(
      repository.reserveUploads(lease, [{ sha256: digest(25), byteSize: 100 }]),
    ).rejects.toThrow("run budget reached");
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM provider_legal_document_uploads",
        )
        .get(),
    ).toEqual({ count: 24 });
  });
  it("enforces the byte budget before object writes", async () => {
    await repository.reserveUploads(
      lease,
      Array.from({ length: 8 }, (_, index) => ({
        sha256: digest(index + 1),
        byteSize: 8 * 1024 * 1024,
      })),
    );
    await expect(
      repository.reserveUploads(lease, [{ sha256: digest(9), byteSize: 1 }]),
    ).rejects.toThrow("run budget reached");
  });
  it("uses a single indexed manifest read for 120 sources and scopes downloads", async () => {
    for (let index = 1; index <= 120; index += 1)
      await repository.record(
        lease,
        digest(index),
        { ...syntheticDocumentCapture(), naturalKeySha256: digest(index) },
        captureObjects(),
      );
    d1.queries.length = 0;
    const manifest = await repository.manifest(lease);
    expect(manifest.captures).toHaveLength(120);
    expect(d1.queries).toHaveLength(1);
    const plan = d1.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${d1.queries[0] ?? ""}`)
      .all("hh_demo", "sydecar");
    expect(plan.map((row) => row.detail).join("\n")).toContain(
      "SEARCH latest USING INDEX",
    );
    expect(plan.map((row) => row.detail).join("\n")).toContain(
      "SEARCH observation USING INDEX",
    );
    expect(plan.map((row) => row.detail).join("\n")).not.toMatch(
      /SCAN (?:latest|observation)/u,
    );
    const id = manifest.captures[0]?.documents[0]?.id ?? "";
    d1.queries.length = 0;
    await expect(
      repository.document("synthetic-access-subject", id),
    ).resolves.toMatchObject({
      content_type: "application/pdf",
      scan_outcome: "clean",
    });
    expect(d1.queries).toHaveLength(1);
    const downloadPlan = d1.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${d1.queries[0]}`)
      .all("synthetic-access-subject", id)
      .map((row) => row.detail)
      .join("\n");
    expect(downloadPlan).toContain("SEARCH scan USING INDEX");
    expect(downloadPlan).not.toMatch(/SCAN (?:document|scan)/u);
    await expect(repository.document("other-subject", id)).rejects.toThrow(
      "not_found",
    );
  });
  it("fails closed on conflicting or partial evidence while preserving original references", () => {
    const capture = syntheticDocumentCapture();
    const first = capture.documents[0];
    if (first === undefined) throw new Error("Synthetic document missing");
    const document = { ...first, id: crypto.randomUUID() };
    expect(legalNameEvidenceFromDocuments(capture, [document])).toMatchObject({
      state: "document_reported",
      legalName: "Synthetic Atlas SPV LLC",
      documents: [{ id: document.id, page: 1 }],
    });
    expect(
      legalNameEvidenceFromDocuments({ ...capture, problem: "inaccessible" }, [
        document,
      ]),
    ).toMatchObject({
      state: "unavailable",
      problem: "inaccessible",
      legalName: null,
    });
    const other = {
      ...document,
      id: crypto.randomUUID(),
      extraction: {
        ...document.extraction,
        citations: [
          {
            legalName: "Synthetic Different LLC",
            page: 1,
            quote: "Issuer: Synthetic Different LLC",
            role: "issuer" as const,
          },
        ],
      },
    };
    expect(
      legalNameEvidenceFromDocuments(capture, [document, other]),
    ).toMatchObject({ state: "unavailable", problem: "conflicting" });
  });
});
