import { expect, it } from "vitest";
import { legalDocumentTestDatabase } from "./test-support/legal-documents";
import {
  seedPurchaseRefundPractice,
  LINK_DEMO_SUBJECT,
} from "./seed-position-links";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import {
  PurchaseReceiptSchema,
  reviewedInvestmentFromReceipt,
} from "../packages/domain/src/position-purchases";

it("provides a real D1 refund scenario with unresolved fees and selectable proxy evidence", async () => {
  const db = legalDocumentTestDatabase();
  try {
    await seedPurchaseRefundPractice(db.asD1());
    const positions = (
      await new D1InvestmentPositionViewRepository(db.asD1()).list(
        LINK_DEMO_SUBJECT,
      )
    ).connections.flatMap((c) => c.containers.flatMap((c) => c.positions));
    const position = positions.find(
      (p) => p.legalVehicleName === "Demo Atlas Separate SPV",
    )!;
    const row = db.sqlite
      .prepare(
        "SELECT receipt_json FROM holding_purchase_reviews WHERE position_id = ?",
      )
      .get(position.id) as { receipt_json: string };
    const receipt = PurchaseReceiptSchema.parse(JSON.parse(row.receipt_json));
    expect(receipt.details.lots[0]!.capitalReturn).toMatchObject({
      status: "received",
      effectiveDate: null,
      reportedDistributions: "unknown",
    });
    expect(reviewedInvestmentFromReceipt(receipt)).toMatchObject({
      cashPaidMinor: 800_000,
      returnedCapitalMinor: 187_654,
      netCapitalMinor: null,
      upfrontDeductionsMinor: null,
    });
    const prices = await new D1PositionPurchaseRepository(db.asD1()).evidence(
      LINK_DEMO_SUBJECT,
      position.id,
    );
    expect(prices).toHaveLength(1);
    expect(prices[0]).toMatchObject({
      sourceLabel: "Tokenfolio",
      markMicros: 495_000_000,
      markDate: null,
      shareClass: "Common",
    });
  } finally {
    db.sqlite.close();
  }
});
