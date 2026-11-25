import { expect, it } from "vitest";
import { legalDocumentTestDatabase } from "../../../scripts/test-support/legal-documents";
import {
  firstCedarClose,
  nextCedarClose,
  firstPrivateProxyClose,
  nextPrivateProxyClose,
  seedClosingPrice,
} from "../../../scripts/seed-closing-price";
import { LINK_DEMO_SUBJECT as subject } from "../../../scripts/seed-position-links";
import {
  decideMarketSource,
  listMarketReviews,
  marketReviewDetail,
  recordOfficialClose,
  setMarketNewsRead,
} from "./market-close";
import { D1PositionLinkRepository } from "./position-links";
import { D1ExposureRepository } from "./exposures";
import { D1PositionValueAdjustmentRepository } from "./position-value-adjustments";
import { D1HoldingsPageRepository } from "./holdings-page";
import { D1PositionPurchaseRepository } from "./position-purchases";
import {
  effectivePositionValuation,
  publicClosingValuation,
} from "@keel/domain/position-purchases";

it("one household decision follows both positions through the next official close and keeps the original GP evidence", async () => {
  const store = legalDocumentTestDatabase();
  try {
    const db = store.asD1(),
      exposureId = await seedClosingPrice(db);
    const read = async () =>
      (await marketReviewDetail(db, subject, exposureId))!;
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
    await expect(
      recordOfficialClose(db, {
        ...nextCedarClose,
        exposureId,
        date: "2099-01-05",
        observedAt: "2099-01-05T22:00:00.000Z",
      }),
    ).rejects.toThrow("future");
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
    const restored = await groveReceipt();
    expect(restored.publicClose).toBeUndefined();
    expect(restored.latestGpPrice).toBeUndefined();
    const [market] = await listMarketReviews(db, subject);
    expect(
      market?.positions.find((p) => p.id === groveId)?.latestGpPrice
        ?.priceMicros,
    ).toBe(43_000_000);
  } finally {
    store.sqlite.close();
  }
});

it("approves only the visible position and allows a reviewed mapping correction", async () => {
  const store = legalDocumentTestDatabase();
  try {
    const db = store.asD1();
    const exposure = await seedClosingPrice(db);
    const review = async (id = exposure) =>
      (await marketReviewDetail(db, subject, id))!;
    const follow = (r: Awaited<ReturnType<typeof review>>) =>
      decideMarketSource(db, subject, r.exposureId, {
        choice: "follow",
        token: r.token,
        requestId: crypto.randomUUID(),
      });
    const before = await review();
    const links = new D1PositionLinkRepository(db);
    const { positions } = await links.workspace(subject);
    const grove = positions.find((p) => p.legalVehicleName === "Grove SPV")!;
    const summit = positions.find((p) => p.legalVehicleName === "Summit SPV")!;
    const link = {
      sourcePositionId: grove.id,
      targetPositionId: summit.id,
      expectedSourceSnapshotId: grove.snapshot.id,
      expectedTargetSnapshotId: summit.snapshot.id,
      expectedSourceParticipationReviewId: grove.investmentReview?.id ?? null,
      expectedTargetParticipationReviewId: summit.investmentReview?.id ?? null,
      expectedReviewId: null,
      relationship: "same_investment" as const,
      state: "linked" as const,
      useSourceValue: false,
      note: "",
    };
    const accepted = await links.accept(subject, link);
    expect(await follow(before)).toBe(false);
    const visible = await review();
    expect(visible.positions.map((p) => p.id)).toEqual([summit.id]);
    expect(await follow(visible)).toBe(true);
    await links.accept(subject, {
      ...link,
      state: "unlinked",
      expectedReviewId: accepted.id,
    });
    expect((await review()).positions.map((p) => p.id)).toEqual([summit.id]);

    const exposures = new D1ExposureRepository(db);
    const corrected = await exposures.resolveExposure(subject, {
      exposureKind: "public_instrument",
      canonicalName: "Second synthetic listing",
      protectedIdentityKey: "f".repeat(64),
      evidenceSha256: "e".repeat(64),
    });
    const mapping = {
      positionId: summit.id,
      relationshipKind: "look_through" as const,
      decisionSource: "review" as const,
      decisionReference: "Synthetic company correction",
      effectiveAt: new Date().toISOString(),
      evidenceSha256: "e".repeat(64),
    };
    await exposures.recordMapping(subject, {
      ...mapping,
      exposureId: exposure,
      status: "withdrawn",
      allocationPpm: null,
    });
    await exposures.recordMapping(subject, {
      ...mapping,
      exposureId: corrected.id,
      status: "active",
      allocationPpm: 1_000_000,
    });
    await db
      .prepare(
        `INSERT INTO exposure_market_listings SELECT ?,instrument_id,ticker,venue,share_class,basis_key,first_session,identity_source_url,currency FROM exposure_market_listings WHERE exposure_id=?`,
      )
      .bind(corrected.id, exposure)
      .run();
    await recordOfficialClose(db, {
      ...firstCedarClose,
      exposureId: corrected.id,
    });
    expect(await follow(await review(corrected.id))).toBe(true);
    expect((await review(corrected.id)).positions.map((p) => p.id)).toEqual([
      summit.id,
    ]);
    expect(
      store.sqlite
        .prepare("SELECT count(*) AS n FROM exposure_market_decisions")
        .get()?.n,
    ).toBe(2);
  } finally {
    store.sqlite.close();
  }
});

it("requires a fresh comparison after an accepted adjustment changes the prior value", async () => {
  const store = legalDocumentTestDatabase();
  try {
    const db = store.asD1();
    const exposure = await seedClosingPrice(db);
    const positions = (
      await new D1PositionLinkRepository(db).workspace(subject)
    ).positions;
    const grove = positions.find((p) => p.legalVehicleName === "Grove SPV")!;
    const receipt = grove.purchaseReceipt!;
    // Model a position with confirmed shares and only a provider-reported value.
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT INTO holding_purchase_reviews
      (id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at)
      SELECT ?,household_id,position_id,snapshot_id,id,
      json_set(json_remove(receipt_json,'$.details.valuation'),'$.id',?,'$.acceptedAt',?),
      reviewer_user_id,? FROM holding_purchase_reviews WHERE id=?`,
      )
      .bind(id, id, now, now, receipt.id)
      .run();
    const before = (await marketReviewDetail(db, subject, exposure))!;
    await new D1PositionValueAdjustmentRepository(db).accept(
      subject,
      grove.id,
      {
        expectedSnapshotId: grove.snapshot.id,
        expectedAdjustmentId: null,
        valueMinor: 1_234_500,
        currency: "USD",
        effectiveDate: "2026-10-01",
        sourceKind: "gp_update",
        sourceLabel: "Revised GP report",
        commentary: "Synthetic interim correction",
        sourceUrl: null,
      },
    );
    const after = (await marketReviewDetail(db, subject, exposure))!;
    expect(after.positions.find((p) => p.id === grove.id)?.previousMinor).toBe(
      1_234_500,
    );
    expect(
      await decideMarketSource(db, subject, exposure, {
        choice: "follow",
        token: before.token,
        requestId: crypto.randomUUID(),
      }),
    ).toBe(false);
    expect(
      await decideMarketSource(db, subject, exposure, {
        choice: "follow",
        token: after.token,
        requestId: crypto.randomUUID(),
      }),
    ).toBe(true);
  } finally {
    store.sqlite.close();
  }
});

it("keeps the accepted private-share proxy and dated value anchor through closes and staggered stock deliveries", async () => {
  const store = legalDocumentTestDatabase();
  try {
    const db = store.asD1();
    const exposure = await seedClosingPrice(db, true);
    const review = (await marketReviewDetail(db, subject, exposure))!;
    const grove = review.positions.find((p) => p.name === "Grove SPV")!;
    const summit = review.positions.find((p) => p.name === "Summit SPV")!;
    expect([
      grove.proxyBasis?.method,
      grove.valueMinor,
      summit.proxyBasis?.method,
      summit.quantityMicros,
      summit.valueMinor,
    ]).toEqual(["indicative_shares", 500000, "price_change", null, 270000]);
    const decision = {
      requestId: crypto.randomUUID(),
      token: review.token,
      choice: "follow" as const,
    };
    expect(await decideMarketSource(db, subject, exposure, decision)).toBe(
      false,
    );
    expect(
      await decideMarketSource(db, subject, exposure, {
        ...decision,
        acceptProxyBasis: true,
      }),
    ).toBe(true);
    const purchases = new D1PositionPurchaseRepository(db);
    const read = async (id: string) => {
      const page = await new D1HoldingsPageRepository(db).getPage(
        subject,
        "available",
      );
      return page.holdings.find(
        (h) => h.purchaseContext?.receipt?.positionId === id,
      )!.purchaseContext!.receipt!;
    };
    const summitReceipt = await read(summit.id);
    expect(summitReceipt.publicClose?.proxyBasis?.method).toBe("price_change");
    const gp = summitReceipt.details.valuation!.records.find(
      (r) => r.id === "gp",
    )!;
    await purchases.acceptValuation(subject, summit.id, {
      expectedReceiptId: summitReceipt.id,
      expectedSnapshotId: summitReceipt.snapshotId,
      method: "total",
      record: {
        ...gp,
        totalMinor: 300000,
        priceMicros: 50000000,
        effectiveDate: nextPrivateProxyClose.date,
        priceDate: nextPrivateProxyClose.date,
      },
    });
    await recordOfficialClose(db, {
      ...nextPrivateProxyClose,
      exposureId: exposure,
    });
    const values = async () => {
      const result = [];
      for (const id of [grove.id, summit.id]) {
        const receipt = await read(id);
        result.push(
          effectivePositionValuation(receipt, receipt.snapshotId)?.valueMinor,
        );
      }
      return result;
    };
    expect(await values()).toEqual([520000, 280800]);
    const event = (id: string, receivedOn: string, quantityMicros: number) => ({
      id,
      receivedOn,
      kind: "in_kind" as const,
      securityLabel: "CDR",
      quantityMicros,
      investorValueMinor: null,
      spvDebit: {
        ticker: "CDR",
        shareBasis: firstCedarClose.shareBasis,
        quantityMicros,
      },
      sourceLabel: "Synthetic SPV distribution notice",
      sourceUrl: null,
      note: "",
    });
    const events = [
      event("first", firstPrivateProxyClose.date, 25000000),
      event("second", nextPrivateProxyClose.date, 15000000),
    ];
    for (const [index, batch] of events.entries()) {
      const prior = await read(grove.id);
      await purchases.acceptDistributions(subject, grove.id, {
        expectedReceiptId: prior.id,
        expectedSnapshotId: prior.snapshotId,
        distributionReview: {
          method: "capital_return_first_v1",
          events: events.slice(0, index + 1),
          coverage: { status: "complete", throughDate: batch.receivedOn },
          priorCarry: { status: "unknown" },
          provider: {
            inclusion: "unknown",
            sourceSnapshotId: prior.snapshotId,
            realizedValueMinor: 0,
          },
          sourceLabel: "Distribution history",
          sourceUrl: null,
          note: "",
        },
      });
      expect(await values()).toEqual([index === 0 ? 390000 : 312000, 280800]);
    }
    const delivered = await read(grove.id);
    const notice = delivered.details.distributionReview!;
    const first = notice.events[0]!;
    if (first.kind !== "in_kind" || !first.spvDebit || !delivered.publicClose)
      throw new Error("Expected an accepted stock release and price proxy.");
    const quote = delivered.publicClose;
    const markWith = (stockEvent: typeof first) =>
      publicClosingValuation(
        {
          ...delivered,
          details: {
            ...delivered.details,
            distributionReview: { ...notice, events: [stockEvent] },
          },
        },
        quote,
      );
    // A 25-share release still debits 25 when only 20 reach the investor after carry.
    expect(markWith({ ...first, quantityMicros: 20000000 })?.valueMinor).toBe(
      390000,
    );
    const { spvDebit, ...legacyEvent } = first;
    expect(markWith(legacyEvent)).toBeNull();
    expect(
      markWith({ ...first, spvDebit: { ...spvDebit, ticker: "OTHER" } }),
    ).toBeNull();
    const split = {
      ...quote,
      priceMicros: Number(BigInt(quote.priceMicros) / 2n),
      shareBasis: { ...quote.shareBasis, unitsPerOriginal: 2 },
    };
    expect(publicClosingValuation(delivered, split)?.valueMinor).toBe(312000);
    const indexed = await read(summit.id);
    expect(
      publicClosingValuation(indexed, {
        ...split,
        proxyBasis: indexed.publicClose!.proxyBasis,
      })?.valueMinor,
    ).toBe(280800);
    const final = (await marketReviewDetail(db, subject, exposure))!;
    expect(final.choice).toBe("follow");
    expect(final.version).toBe(1);
    expect(final.positions.find((p) => p.id === summit.id)?.previousMinor).toBe(
      300000,
    );
  } finally {
    store.sqlite.close();
  }
});
