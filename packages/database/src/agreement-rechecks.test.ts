import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  legalDocumentTestDatabase,
  syntheticDocumentCapture,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import { D1ProviderPortfolioAgentRepository } from "./provider-portfolio-agent";
import { D1ProviderLegalDocumentRepository } from "./provider-legal-documents";

let db: LegalDocumentTestD1;
beforeEach(() => {
  db = legalDocumentTestDatabase();
});
afterEach(() => db.sqlite.close());

describe("agreement recheck state machine", () => {
  it.each(["clean", "blocked"] as const)(
    "requires a fresh exact-target scan before completing %s, and never applies holdings",
    async (outcome) => {
      const subject = "synthetic-access-subject";
      const beforeEntities = db.sqlite
        .prepare("SELECT * FROM legal_entities ORDER BY id")
        .all();
      const beforeHoldings = db.sqlite
        .prepare("SELECT * FROM holding_positions ORDER BY id")
        .all();
      let now = new Date("2026-09-01T12:00:00.000Z");
      const agents = new D1ProviderPortfolioAgentRepository(
        db.asD1(),
        () => now,
      );
      const documents = new D1ProviderLegalDocumentRepository(
        db.asD1(),
        () => now,
      );
      await agents.register(subject, "sydecar");
      await agents.register(subject, "tokenfolio");
      await agents.requestRun(subject, "sydecar");
      const originalRun = (await agents.lease(subject, "sydecar")).run!;
      const capture = syntheticDocumentCapture();
      const originalLease = await documents.lease(
        subject,
        "sydecar",
        originalRun.id,
        originalRun.leaseToken,
      );
      await documents.record(originalLease, "a".repeat(64), capture, [
        {
          sha256: capture.documents[0]!.sha256,
          objectKey: "quarantine/synthetic.pdf",
        },
      ]);
      const id = (await documents.manifest(originalLease)).captures[0]!
        .documents[0]!.id;
      await agents.fail(
        subject,
        "sydecar",
        originalRun.id,
        originalRun.leaseToken,
        { errorCode: "unexpected_failure" },
      );
      await expect(
        agents.requestRun(subject, "tokenfolio", id),
      ).rejects.toThrow();
      // Interleave another successful request after our active-run read. The
      // loser must return the same pinned target, not create duplicate work.
      const winningRunId = crypto.randomUUID();
      db.beforeBatch = () => {
        db.sqlite
          .prepare(
            `INSERT INTO provider_portfolio_runs
          (id, household_id, agent_id, requested_by_user_id, request_kind, status, requested_at, recheck_document_id)
          SELECT ?, 'hh_demo', id, 'usr_demo', 'manual', 'queued', ?, ? FROM provider_portfolio_agents WHERE household_id = 'hh_demo' AND provider = 'sydecar'`,
          )
          .run(winningRunId, now.toISOString(), id);
      };
      const requested = await agents.requestRun(subject, "sydecar", id);
      expect(requested.runId).toBe(winningRunId);
      expect(await agents.requestRun(subject, "sydecar", id)).toEqual(
        requested,
      );
      await expect(
        agents.requestRun(subject, "sydecar", crypto.randomUUID()),
      ).rejects.toThrow("run_in_progress");
      now = new Date("2026-09-01T12:01:00.000Z");
      const run = (await agents.lease(subject, "sydecar")).run!;
      expect(run.recheckDocumentId).toBe(id);
      expect((await agents.lease(subject, "sydecar")).run).toBeNull();
      expect(() =>
        db.sqlite
          .prepare(
            "UPDATE provider_portfolio_runs SET recheck_document_id = NULL WHERE id = ?",
          )
          .run(run.id),
      ).toThrow("target is immutable");
      // A synthetic review-pending import satisfies the ordinary job boundary,
      // but does not satisfy the additional document recheck completion gate.
      db.sqlite
        .prepare(
          `INSERT INTO holding_imports (id, household_id, source_document_id, provider, parser_schema, row_count, created_by, created_at)
      VALUES ('synthetic_recheck_import', 'hh_demo', ?, 'sydecar', 'sydecar_keel_template_v1', 1, 'usr_demo', ?)`,
        )
        .run(id, now.toISOString());
      const complete = () =>
        agents.complete(
          subject,
          "sydecar",
          run.id,
          run.leaseToken,
          "synthetic_recheck_import",
        );
      // Inspect the real trigger query, not a simplified surrogate. Both the
      // current run and prior matching source use indexed searches.
      const migration = readFileSync(
        resolve("packages/database/migrations/0050_agreement_rechecks.sql"),
        "utf8",
      );
      const proof = migration
        .split("CREATE TRIGGER provider_portfolio_recheck_completion")[1]!
        .match(/WHERE NOT EXISTS \(([\s\S]+)\);/u)![1]!
        .replaceAll("NEW.id", ":runId")
        .replaceAll("NEW.household_id", ":householdId")
        .replaceAll("NEW.recheck_document_id", ":documentId")
        .replaceAll("NEW.started_at", ":startedAt");
      const plan = db.sqlite
        .prepare(`EXPLAIN QUERY PLAN ${proof}`)
        .all({
          runId: run.id,
          householdId: "hh_demo",
          documentId: id,
          startedAt: now.toISOString(),
        })
        .map((row) => row.detail)
        .join("\n");
      expect(plan).toContain(
        "SEARCH current USING INDEX provider_legal_documents_recheck_run_idx",
      );
      expect(plan).toContain(
        "SEARCH prior USING INDEX provider_legal_documents_recheck_source_idx",
      );
      expect(plan).not.toMatch(/SCAN (?:current|prior)/u);
      await expect(complete()).rejects.toThrow("no fresh scan");
      const leased = await documents.lease(
        subject,
        "sydecar",
        run.id,
        run.leaseToken,
      );
      // Unrelated evidence from the same run must not unblock completion.
      await documents.record(
        leased,
        "c".repeat(64),
        { ...capture, naturalKeySha256: "c".repeat(64) },
        [],
      );
      await expect(complete()).rejects.toThrow("no fresh scan");
      const fresh = structuredClone(capture);
      const document = fresh.documents[0]!;
      document.checkedAt = now.toISOString();
      document.scan = {
        ...document.scan!,
        version: 2,
        scannedAt: now.toISOString(),
        outcome,
        findings:
          outcome === "clean"
            ? []
            : [{ reason: "encrypted", signature: "Heuristics.Encrypted.PDF" }],
      };
      if (outcome === "blocked")
        document.extraction = {
          version: 3,
          pageCount: 0,
          problem: "security_blocked",
          citations: [],
        };
      await documents.record(leased, "a".repeat(64), fresh, []);
      const evidence = (await documents.manifest(leased)).captures.find(
        (item) => item.naturalKeySha256 === fresh.naturalKeySha256,
      )!;
      expect(evidence.documents[0]!.scan).toEqual(document.scan);
      await expect(complete()).resolves.toMatchObject({ status: "ready" });
      await expect(complete()).rejects.toThrow("lease_invalid");
      expect(
        db.sqlite.prepare("SELECT * FROM legal_entities ORDER BY id").all(),
      ).toEqual(beforeEntities);
      expect(
        db.sqlite.prepare("SELECT * FROM holding_positions ORDER BY id").all(),
      ).toEqual(beforeHoldings);
      expect((await documents.document(subject, id)).scan_outcome).toBe(
        outcome,
      );
    },
  );
});
