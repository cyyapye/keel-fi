import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { buildEntityReviewSeed } from "./seed-entity-review";
import { legalDocumentTestDatabase } from "./test-support/legal-documents";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1LegalEntityRepository } from "../packages/database/src/legal-entities";
import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";

it("replays the synthetic review seed into native D1-shaped state with usable document hashes and distinct evidence", async () => {
  const seed = await buildEntityReviewSeed();
  const d1 = legalDocumentTestDatabase();
  try {
    d1.sqlite.exec(seed.sql);
    expect(d1.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const subject = "synthetic-access-subject";
    const view = await new D1InvestmentPositionViewRepository(d1.asD1()).list(
      subject,
      "2026-09-01T12:00:00.000Z",
    );
    const inventory = await new D1LegalEntityRepository(d1.asD1()).getState(
      subject,
      view,
    );
    expect(inventory.candidates.length).toBeGreaterThan(25);
    expect(
      inventory.candidates.find((c) => c.sourceDisplayName === "Demo Meridian")
        ?.legalEntityNameEvidence,
    ).toMatchObject({ problem: "conflicting" });
    expect(
      inventory.candidates.find((c) => c.sourceDisplayName === "Demo Orchard")
        ?.legalEntityNameEvidence,
    ).toMatchObject({ problem: "name_not_found" });
    const cancelled = inventory.candidates.find(
      (c) => c.sourceDisplayName === "Demo Cancelled Subscription",
    )!;
    expect(cancelled.investmentReview?.participationStatus).toBe("cancelled");
    expect(cancelled.financials).toBeNull();
    const reviews = new D1InvestmentReviewRepository(d1.asD1());
    const mapped = await reviews.getContext(
      subject,
      inventory.candidates.find(
        (c) => c.sourceDisplayName === "Demo Growth III",
      )!.source.id,
    );
    expect(mapped.companyChoices).toEqual([]);
    expect(mapped.companyReceipt?.basis).toBe("user_confirmed");
    expect(mapped.mappings).toMatchObject([
      { decisionSource: "review", acceptedAt: expect.any(String) },
    ]);
    const supported = await reviews.getContext(
      subject,
      inventory.candidates.find(
        (c) => c.sourceDisplayName === "Demo Growth IV",
      )!.source.id,
    );
    expect(supported.companyChoices.length).toBeGreaterThan(0);
    expect(supported.companyReceipt?.basis).toBe("document_choice");
    for (const file of seed.files) {
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      expect(file.objectKey).toBe(
        `legal-entity-documents/hh_demo/${sha256}.pdf`,
      );
      expect(new TextDecoder().decode(file.bytes)).toContain("SYNTHETIC DEMO");
    }
  } finally {
    d1.sqlite.close();
  }
});
