import { D1PositionPurchaseRepository } from "./position-purchases";
import { automaticEconomics } from "@keel/domain/automatic-investment-review";
import type { PurchaseReceipt } from "@keel/domain/position-purchases";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import { seedAutomaticInvestments } from "../../../scripts/test-support/automatic-investments";
import {
  automaticReviewJsonBatches,
  D1AutomaticInvestmentReviewRepository,
} from "./automatic-investment-review";
import { D1InvestmentReviewRepository } from "./investment-review";
import { D1PositionEconomicsRepository } from "./position-economics";
import { calculatePositionEconomics } from "@keel/domain/position-economics";
import { D1AlphaRepository } from "./index";

const subject = "synthetic-access-subject";
let d1: LegalDocumentTestD1;
beforeEach(() => {
  d1 = legalDocumentTestDatabase();
});
afterEach(() => d1.sqlite.close());

const seed = (count = 1, extraLines: string[] = [], sharedName = false) =>
  seedAutomaticInvestments(d1.asD1(), count, extraLines, sharedName);

const receipt = (id: string) =>
  JSON.parse(
    (
      d1.sqlite
        .prepare(
          "SELECT summary_json FROM automatic_investment_reviews WHERE position_id = ? ORDER BY version DESC LIMIT 1",
        )
        .get(id) as { summary_json: string }
    ).summary_json,
  ) as { resolved: string[]; issues: { section: string; code: string }[] };

describe("exception-based investment review", () => {
  it("reconciles matching purchase fees and rejects conflicting or stale purchase evidence", async () => {
    const [id] = await seed();
    const review = await new D1InvestmentReviewRepository(d1.asD1()).getContext(
      subject,
      id!,
    );
    const context = {
      ...review.economics!,
      committedMinor: 4_000_000,
      acceptedTerms: null,
    };
    const purchase: PurchaseReceipt = {
      id: "synthetic-purchase",
      positionId: id!,
      snapshotId: context.snapshotId,
      currency: "USD",
      acceptedAt: "2026-09-01T12:00:00.000Z",
      details: {
        coversPosition: false,
        lots: [
          {
            id: "synthetic-lot",
            purchasedOn: null,
            shareClass: "Preferred",
            priceMicros: null,
            referencePriceMicros: null,
            grossCashMinor: null,
            netCapitalMinor: null,
            feePpm: 60_000,
            feeBasis: "net_capital",
            feeLabel: "Underlying fee",
            originalSharesUnchanged: false,
            remainingSharesMicros: null,
            sharesAsOf: null,
            sourceLabel: "Synthetic notice",
            sourceUrl: null,
            mark: null,
            reportedManagementFeePpm: 60_000,
            reportedCarryPpm: 175_000,
          },
        ],
      },
    };
    const documents = review.documents.map((doc) => ({
      ...doc,
      economicsCitations: doc.economicsCitations?.map((citation) =>
        citation.field === "netInvestedMinor"
          ? { ...citation, value: 3_500_000 }
          : citation,
      ),
    }));
    const result = automaticEconomics(context, documents, purchase);
    expect(result.issue).toBeNull();
    const savedPurchase = await new D1PositionPurchaseRepository(
      d1.asD1(),
    ).accept(subject, id!, {
      expectedSnapshotId: context.snapshotId,
      expectedReceiptId: null,
      details: {
        ...purchase.details,
        lots: [{ ...purchase.details.lots[0]!, feePpm: 0 }],
      },
    });
    await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
    const acceptedReview = await new D1InvestmentReviewRepository(
      d1.asD1(),
    ).getContext(subject, id!);
    expect(acceptedReview.economics?.acceptedTerms).toMatchObject({
      decisionSource: "policy",
      purchaseFee: {
        receiptId: savedPurchase.id,
        ratePpm: 0,
        basis: "net_capital",
      },
    });

    expect(result.input?.purchaseFee).toMatchObject({
      receiptId: purchase.id,
      ratePpm: 60_000,
      basis: "net_capital",
    });
    expect(
      automaticEconomics(context, documents, {
        ...purchase,
        snapshotId: "stale",
      }).issue?.code,
    ).toBe("unsupported");
    expect(
      automaticEconomics(context, documents, {
        ...purchase,
        details: {
          ...purchase.details,
          lots: [{ ...purchase.details.lots[0]!, reportedCarryPpm: 100_000 }],
        },
      }).issue?.code,
    ).toBe("conflicting");
    expect(
      automaticEconomics(context, documents, {
        ...purchase,
        details: {
          ...purchase.details,
          lots: [
            purchase.details.lots[0]!,
            { ...purchase.details.lots[0]!, id: "another-lot" },
          ],
        },
      }).issue?.code,
    ).toBe("unsupported");
  });

  it("re-evaluates legacy cached summaries once and then returns to a write-free retry", async () => {
    await seed();
    const originalBatch = d1.batch.bind(d1);
    d1.batch = (statements) =>
      originalBatch(
        statements.map((statement) => {
          if (
            !statement.sql.startsWith(
              "INSERT INTO automatic_investment_reviews",
            )
          )
            return statement;
          const values = [...statement.values];
          if (typeof values[0] !== "string")
            throw new Error("Expected a synthetic automatic-review batch.");
          const records = JSON.parse(values[0]) as {
            result_guard_json: string;
          }[];
          for (const record of records) {
            const guard = JSON.parse(record.result_guard_json) as Record<
              string,
              unknown
            >;
            delete guard.evaluationVersion;
            record.result_guard_json = JSON.stringify(guard);
          }
          values[0] = JSON.stringify(records);
          return statement.bind(...values);
        }),
      );
    const automatic = new D1AutomaticInvestmentReviewRepository(d1.asD1());
    await automatic.resolve(subject);
    d1.batch = originalBatch;
    expect((await automatic.resolve(subject)).changedCount).toBe(1);
    d1.queries.length = 0;
    expect((await automatic.resolve(subject)).changedCount).toBe(0);
    expect(d1.queries.every((sql) => sql.startsWith("SELECT"))).toBe(true);
  });
  it.each(["confirm", "correct", "link"] as const)(
    "flags evidence that contradicts an earlier company decision and honors an explicit %s decision",
    async (decision) => {
      const [id] = await seed();
      const reviews = new D1InvestmentReviewRepository(d1.asD1());
      const initial = await reviews.getContext(subject, id!);
      const originalBatch = d1.batch.bind(d1);
      // Reproduce a receipt written before company-evidence acknowledgements existed.
      d1.batch = (statements) =>
        originalBatch(
          statements.map((statement) => {
            if (
              !statement.sql.startsWith(
                "INSERT INTO investment_company_reviews",
              )
            )
              return statement;
            const values = [...statement.values];
            if (typeof values[5] !== "string")
              throw new Error("Expected a synthetic company-review receipt.");
            const legacy = JSON.parse(values[5]) as Record<string, unknown>;
            delete legacy.companyEvidenceRevision;
            values[5] = JSON.stringify(legacy);
            return statement.bind(...values);
          }),
        );
      const earlier = await reviews.reviewCompany(subject, id!, {
        requestId: crypto.randomUUID(),
        expectedSnapshotId: initial.snapshotId,
        expectedEvidenceRevision: initial.evidenceRevision,
        expectedMappingIds: initial.mappings.map((mapping) => mapping.id),
        company: { mode: "new", legalName: "Synthetic Earlier Company Inc." },
        basis: "user_confirmed",
        citation: null,
        reason: null,
      });
      d1.batch = originalBatch;
      const automatic = new D1AutomaticInvestmentReviewRepository(d1.asD1());
      await automatic.resolve(subject);
      expect(receipt(id!).issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ section: "company", code: "conflicting" }),
        ]),
      );
      const conflicted = await reviews.getContext(subject, id!);
      expect(
        conflicted.mappings.filter((mapping) => mapping.status === "active"),
      ).toMatchObject([{ companyName: "Synthetic Earlier Company Inc." }]);
      await reviews.reviewCompany(subject, id!, {
        requestId: crypto.randomUUID(),
        expectedSnapshotId: conflicted.snapshotId,
        expectedEvidenceRevision: conflicted.evidenceRevision,
        expectedMappingIds: conflicted.mappings.map((mapping) => mapping.id),
        company:
          decision !== "correct"
            ? { mode: "existing", companyId: earlier.companyId }
            : {
                mode: "new",
                legalName: conflicted.companyChoices[0]!.companyName,
              },
        basis:
          decision === "confirm"
            ? "user_confirmed"
            : decision === "link"
              ? "document_link"
              : "document_choice",
        citation: decision === "confirm" ? null : conflicted.companyChoices[0]!,
        reason: null,
      });
      await automatic.resolve(subject);
      expect(
        receipt(id!).issues.filter((item) => item.section === "company"),
      ).toEqual([]);
      const confirmed = await reviews.getContext(subject, id!);
      expect(confirmed.companyReceipt?.companyEvidenceRevision).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      expect(
        confirmed.mappings.filter((mapping) => mapping.status === "active"),
      ).toMatchObject([
        {
          companyName:
            decision !== "correct"
              ? "Synthetic Earlier Company Inc."
              : "Synthetic Orchard Inc.",
        },
      ]);
      d1.queries.length = 0;
      await automatic.resolve(subject);
      expect(d1.queries.every((sql) => sql.startsWith("SELECT"))).toBe(true);
    },
  );
  it("keeps large UTF-8 citation bindings below D1's string limit without losing records", () => {
    const records = Array.from({ length: 8 }, (_, index) => ({
      index,
      quote: "é".repeat(200_000),
    }));
    expect(
      new TextEncoder().encode(JSON.stringify(records)).byteLength,
    ).toBeGreaterThan(2_000_000);
    const batches = automaticReviewJsonBatches(records);
    expect(batches.length).toBeGreaterThan(1);
    for (const batch of batches)
      expect(new TextEncoder().encode(batch).byteLength).toBeLessThanOrEqual(
        1_500_000,
      );
    expect(batches.flatMap((batch) => JSON.parse(batch) as unknown[])).toEqual(
      records,
    );
  });
  it("retries a racing document check as an exception without applying its financial terms", async () => {
    const [id] = await seed();
    const context = await new D1InvestmentReviewRepository(
      d1.asD1(),
    ).getContext(subject, id!);
    const doc = context.documents[0]!;
    d1.beforeBatch = () => {
      const scan = {
        ...doc.scan!,
        outcome: "blocked",
        scannedAt: "2026-09-02T12:00:00.000Z",
      };
      d1.sqlite
        .prepare(
          "UPDATE private_document_scans SET outcome = 'blocked', scanned_at = ?, scan_json = ? WHERE document_id = ?",
        )
        .run(scan.scannedAt, JSON.stringify(scan), doc.id);
    };
    await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
    expect(receipt(id!).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: "documents",
          code: "document_check",
        }),
      ]),
    );
    expect(
      d1.sqlite
        .prepare("SELECT count(*) n FROM holding_position_economics_proposals")
        .get(),
    ).toMatchObject({ n: 0 });
    expect(
      d1.sqlite
        .prepare("SELECT count(*) n FROM investment_company_reviews")
        .get(),
    ).toMatchObject({ n: 0 });
  });

  it("lets a racing manual fee correction win and makes a duplicate automatic request a no-op", async () => {
    const [id] = await seed();
    const context = await new D1InvestmentReviewRepository(
      d1.asD1(),
    ).getContext(subject, id!);
    const originalBatch = d1.batch.bind(d1);
    let manualStatements: Parameters<typeof d1.batch>[0] = [];
    d1.batch = (statements) => {
      manualStatements = statements;
      return Promise.resolve([]);
    };
    const terms = await new D1PositionEconomicsRepository(d1.asD1()).accept(
      subject,
      id!,
      {
        expectedSnapshotId: context.snapshotId!,
        expectedTermsId: null,
        capitalBasis: "net_invested",
        grossCommitmentMinor: 4_000_000,
        annualAdminFeePpm: 60_000,
        adminFeeYears: 1,
        setupFeePpm: 12_500,
        carryPpm: 125_000,
        note: "Synthetic correction before automatic commit.",
      },
    );
    d1.batch = originalBatch;
    d1.beforeBatch = () => {
      for (const statement of manualStatements) statement.execute();
    };
    const automatic = new D1AutomaticInvestmentReviewRepository(d1.asD1());
    await Promise.all([automatic.resolve(subject), automatic.resolve(subject)]);
    const updated = await new D1InvestmentReviewRepository(
      d1.asD1(),
    ).getContext(subject, id!);
    expect(updated.economics?.acceptedTerms).toMatchObject({
      id: terms.id,
      carryPpm: 125_000,
      decisionSource: "manual",
    });
    expect(
      d1.sqlite
        .prepare("SELECT count(*) n FROM holding_position_economics_proposals")
        .get(),
    ).toMatchObject({ n: 1 });
    expect(
      d1.sqlite
        .prepare(
          "SELECT count(*) n FROM automatic_investment_reviews WHERE position_id = ?",
        )
        .get(id!),
    ).toMatchObject({ n: 1 });
  });
  it("accepts cited identity, company, participation, and reconciled fees without reducing net capital twice", async () => {
    const [id] = await seed();
    const application = d1.sqlite
      .prepare(
        "SELECT r.import_id FROM holding_import_applications a JOIN holding_import_rows r ON r.id = a.import_row_id WHERE a.position_id = ?",
      )
      .get(id!) as { import_id: string };
    await new D1AlphaRepository(d1.asD1()).reconcileHoldingImport(
      subject,
      application.import_id,
    );
    expect(receipt(id!)).toMatchObject({
      resolved: expect.arrayContaining([
        "identity",
        "company",
        "participation",
        "economics",
        "documents",
      ]),
      issues: [],
    });
    const context = await new D1InvestmentReviewRepository(
      d1.asD1(),
    ).getContext(subject, id!);
    expect(calculatePositionEconomics(context.economics!)).toMatchObject({
      committedMinor: 4_000_000,
      positionCostBasisMinor: 3_710_000,
      upfrontAdminFeeMinor: 240_000,
      setupFeeMinor: 50_000,
    });
    expect(context.companyReceipt).toMatchObject({
      companyName: "Synthetic Orchard Inc.",
      decisionSource: "deterministic_policy",
    });
    expect(
      d1.sqlite
        .prepare(
          "SELECT allocation_minor FROM holding_position_snapshots WHERE id = ?",
        )
        .get(context.snapshotId),
    ).toMatchObject({ allocation_minor: 3_710_000 });
    d1.queries.length = 0;
    await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
    expect(d1.queries.every((sql) => sql.startsWith("SELECT"))).toBe(true);
  });

  it("preserves later manual fee and participation corrections across recovery", async () => {
    const [id] = await seed();
    const automatic = new D1AutomaticInvestmentReviewRepository(d1.asD1());
    await automatic.resolve(subject);
    const reviews = new D1InvestmentReviewRepository(d1.asD1());
    const context = await reviews.getContext(subject, id!);
    const terms = await new D1PositionEconomicsRepository(d1.asD1()).accept(
      subject,
      id!,
      {
        expectedSnapshotId: context.snapshotId!,
        expectedTermsId: context.economics!.acceptedTerms!.id,
        capitalBasis: "net_invested",
        grossCommitmentMinor: 4_000_000,
        annualAdminFeePpm: 60_000,
        adminFeeYears: 1,
        setupFeePpm: 12_500,
        carryPpm: 125_000,
        note: "Corrected synthetic side letter carry.",
      },
    );
    await reviews.review(subject, id!, {
      requestId: crypto.randomUUID(),
      expectedReviewId: null,
      expectedSnapshotId: context.snapshotId,
      expectedEvidenceRevision: context.evidenceRevision,
      participationStatus: "historical",
    });
    await automatic.resolve(subject);
    const updated = await reviews.getContext(subject, id!);
    expect(updated.economics!.acceptedTerms).toMatchObject({
      id: terms.id,
      carryPpm: 125_000,
    });
    expect(updated.review?.participationStatus).toBe("historical");
  });

  it("surfaces conflicting terms and duplicate vehicles instead of inventing values or merging names", async () => {
    const ids = await seed(2, ["Carry: 22% of exit gains"], true);
    await new D1AutomaticInvestmentReviewRepository(d1.asD1()).resolve(subject);
    for (const id of ids)
      expect(receipt(id).issues).toEqual(
        expect.arrayContaining([
          {
            section: "identity",
            code: "ambiguous_identity",
            message: expect.any(String),
          },
          {
            section: "economics",
            code: "conflicting",
            message: expect.any(String),
          },
        ]),
      );
    expect(
      d1.sqlite
        .prepare("SELECT count(*) n FROM holding_position_economics_proposals")
        .get(),
    ).toMatchObject({ n: 0 });
  });

  it("resolves a bounded 120-position batch with fixed queries and no writes on an unchanged retry", async () => {
    const ids = await seed(120);
    d1.queries.length = 0;
    const automatic = new D1AutomaticInvestmentReviewRepository(d1.asD1());
    await automatic.resolve(subject);
    expect(d1.queries.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(
      7,
    );
    expect(d1.queries.filter((sql) => sql.startsWith("INSERT"))).toHaveLength(
      9,
    );
    for (const id of ids) expect(receipt(id).issues).toEqual([]);
    d1.queries.length = 0;
    await automatic.resolve(subject);
    expect(d1.queries).toHaveLength(7);
    expect(d1.queries.every((sql) => sql.startsWith("SELECT"))).toBe(true);
    const plans = d1.statements
      .filter((statement) => statement.sql.startsWith("SELECT"))
      .slice(-7)
      .flatMap((statement) =>
        d1.sqlite
          .prepare(`EXPLAIN QUERY PLAN ${statement.sql}`)
          .all(...statement.values),
      );
    expect(
      plans
        .map((row) => String(row.detail))
        .filter((detail) =>
          /SCAN (candidate|later|holding_investment_reviews|investment_company_reviews|automatic_investment_reviews)\b/u.test(
            detail,
          ),
        ),
    ).toEqual([]);
  });
});
