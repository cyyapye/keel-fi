import { expect, it } from "vitest";
import { legalDocumentTestDatabase } from "../../../scripts/test-support/legal-documents";
import {
  firstCedarClose,
  nextCedarClose,
  seedClosingPrice,
} from "../../../scripts/seed-closing-price";
import { LINK_DEMO_SUBJECT as subject } from "../../../scripts/seed-position-links";
import {
  decideMarketSource,
  listMarketReviews,
  recordOfficialClose,
  setMarketNewsRead,
} from "./market-close";
import { D1HoldingsPageRepository } from "./holdings-page";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { effectivePositionValuation } from "@keel/domain/position-purchases";

it("one household decision follows both positions through the next official close and keeps the original GP evidence", async () => {
  const store = legalDocumentTestDatabase();
  try {
    const db = store.asD1(),
      exposureId = await seedClosingPrice(db);
    const read = async () => (await listMarketReviews(db, subject))[0]!;
    const holdings = async () => {
      const page = await new D1HoldingsPageRepository(db).getPage(
        subject,
        "available",
      );
      return page.holdings
        .filter((h) => h.purchaseContext?.receipt)
        .map((h) => {
          const c = h.purchaseContext!;
          const v = effectivePositionValuation(c.receipt, c.snapshotId);
          return {
            value: v?.valueMinor ?? c.reportedValueMinor,
            source: v?.origin ?? "provider",
            gp: c.reportedValueMinor,
          };
        })
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    };
    const pending = await read();
    expect(pending.positions.map((p) => p.valueMinor).sort()).toEqual([
      300000, 500000,
    ]);
    expect(pending.choice).toBeNull();
    expect(await setMarketNewsRead(db, subject, exposureId, true, 0)).toBe(
      true,
    );
    expect((await read()).choice).toBeNull();
    const input = {
      choice: "follow" as const,
      token: pending.token,
      requestId: crypto.randomUUID(),
    };
    expect(await listMarketReviews(db, "other household")).toEqual([]);
    expect(
      await decideMarketSource(db, "other household", exposureId, input),
    ).toBe(false);
    expect(await decideMarketSource(db, subject, exposureId, input)).toBe(true);
    expect(await decideMarketSource(db, subject, exposureId, input)).toBe(true);
    expect(await holdings()).toEqual([
      { value: 500000, source: "public_close", gp: 400000 },
      { value: 300000, source: "public_close", gp: 270000 },
    ]);
    const groveId = pending.positions.find((p) => p.name === "Grove SPV")!.id;
    const purchases = new D1PositionPurchaseRepository(db);
    const groveReceipt = async () => {
      const page = await new D1HoldingsPageRepository(db).getPage(
        subject,
        "available",
      );
      return page.holdings.find(
        (h) => h.purchaseContext?.receipt?.positionId === groveId,
      )!.purchaseContext!.receipt!;
    };
    const receipt = await groveReceipt();
    await purchases.acceptValuation(subject, groveId, {
      expectedSnapshotId: receipt.snapshotId,
      expectedReceiptId: receipt.id,
      method: "total",
      record: {
        ...receipt.details.valuation!.records[0]!,
        priceMicros: 43_000_000,
        totalMinor: 430_000,
        priceDate: "2026-11-20",
        effectiveDate: "2026-11-20",
      },
    });
    const latest = await groveReceipt();
    expect(latest?.latestGpPrice?.priceMicros).toBe(43_000_000);
    expect(latest?.publicClose?.priceMicros).toBe(50_000_000);
    await expect(
      recordOfficialClose(db, {
        ...nextCedarClose,
        instrumentId: "different",
        exposureId,
      }),
    ).rejects.toThrow();
    await recordOfficialClose(db, { ...nextCedarClose, exposureId });
    await recordOfficialClose(db, { ...firstCedarClose, exposureId });
    expect(await holdings()).toEqual([
      { value: 520000, source: "public_close", gp: 400000 },
      { value: 312000, source: "public_close", gp: 270000 },
    ]);
    const next = await read();
    expect([next.version, next.choice, next.quote.date, next.read]).toEqual([
      1,
      "follow",
      nextCedarClose.date,
      true,
    ]);
    expect(
      await decideMarketSource(db, subject, exposureId, {
        ...input,
        requestId: crypto.randomUUID(),
        choice: "keep",
      }),
    ).toBe(false);
    expect(
      await decideMarketSource(db, subject, exposureId, {
        requestId: crypto.randomUUID(),
        token: next.token,
        choice: "keep",
      }),
    ).toBe(true);
    expect((await holdings()).map((h) => h.value)).toEqual([430000, 270000]);
  } finally {
    store.sqlite.close();
  }
});
