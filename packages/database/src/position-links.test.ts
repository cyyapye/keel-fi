import { beforeEach, afterEach, expect, it } from "vitest";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import {
  seedPositionLinks,
  LINK_DEMO_SUBJECT,
} from "../../../scripts/seed-position-links";
import { D1PositionLinkRepository } from "./position-links";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { D1HoldingsPageRepository } from "./holdings-page";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
import { gpRecord } from "../../../apps/web/src/holding-value";
import type { AcceptPositionLink } from "@keel/domain/position-links";
let db: LegalDocumentTestD1;
let repo: D1PositionLinkRepository;
beforeEach(async () => {
  db = legalDocumentTestDatabase();
  await seedPositionLinks(db.asD1());
  repo = new D1PositionLinkRepository(db.asD1());
});
afterEach(() => db.sqlite.close());
async function input(
  sourceName: string,
  targetName: string,
  changes: Partial<AcceptPositionLink> = {},
) {
  const w = await repo.workspace(LINK_DEMO_SUBJECT);
  const source = w.positions.find((p) => p.legalVehicleName === sourceName)!;
  const target = w.positions.find((p) => p.legalVehicleName === targetName)!;
  return {
    sourcePositionId: source.id,
    targetPositionId: target.id,
    expectedSourceSnapshotId: source.snapshot.id,
    expectedTargetSnapshotId: target.snapshot.id,
    expectedSourceParticipationReviewId: source.investmentReview?.id ?? null,
    expectedTargetParticipationReviewId: target.investmentReview?.id ?? null,
    expectedReviewId:
      w.links.find((l) => l.sourcePositionId === source.id)?.id ?? null,
    relationship: "same_investment" as const,
    state: "linked" as const,
    useSourceValue: true,
    note: "",
    ...changes,
  };
}
it("counts each investment once, retains distinct same-company SPVs, follows syncs and reverses without deleting history", async () => {
  const page = () =>
    new D1HoldingsPageRepository(db.asD1()).getPage(
      LINK_DEMO_SUBJECT,
      "available",
    );
  expect((await page()).investmentHoldings.exposureView.positions).toHaveLength(
    6,
  );
  const atlas = await input("Demo Atlas AI source", "Demo Atlas II SPV");
  const first = await repo.accept(LINK_DEMO_SUBJECT, atlas);
  await repo.accept(
    LINK_DEMO_SUBJECT,
    await input("Demo Orbit Aerospace source", "Demo Orbit VII SPV"),
  );
  await repo.accept(
    LINK_DEMO_SUBJECT,
    await input("Demo Orbit V SPV", "Demo Orbit VII SPV", {
      relationship: "replaced",
      useSourceValue: false,
    }),
  );
  const state = await page();
  expect(state.investmentHoldings.exposureView.positions).toHaveLength(3);
  const current = state.holdings.find((h) => h.id === atlas.targetPositionId)!;
  expect(current.administratorNavMinor).toBe(4_200_000);
  expect(current.committedMinor).toBe(1_200_000);
  expect(current.linkedReportedValue).toMatchObject({
    sourcePositionId: atlas.sourcePositionId,
    minor: 4_200_000,
  });
  expect(
    state.holdings.some((h) => h.positionName === "Demo Atlas Separate SPV"),
  ).toBe(true);
  expect((await repo.workspace(LINK_DEMO_SUBJECT)).positions).toHaveLength(6);
  expect(
    db.sqlite.prepare("SELECT count(*) n FROM holding_positions").get()?.n,
  ).toBeGreaterThanOrEqual(6);
  await seedPositionLinks(db.asD1(), 2);
  const refreshed = await page();
  expect(refreshed.investmentHoldings.exposureView.positions).toHaveLength(3);
  expect(
    refreshed.holdings.find((h) => h.id === atlas.targetPositionId)
      ?.administratorNavMinor,
  ).toBe(4_300_000);
  await expect(repo.accept(LINK_DEMO_SUBJECT, atlas)).rejects.toThrow(
    /changed/,
  );
  await repo.accept(
    LINK_DEMO_SUBJECT,
    await input("Demo Atlas AI source", "Demo Atlas II SPV", {
      state: "unlinked",
      expectedReviewId: first.id,
    }),
  );
  expect((await page()).investmentHoldings.exposureView.positions).toHaveLength(
    4,
  );
  expect(
    db.sqlite
      .prepare("SELECT count(*) n FROM holding_position_link_reviews")
      .get()?.n,
  ).toBe(4);
  expect(() =>
    db.sqlite.exec("DELETE FROM holding_position_link_reviews"),
  ).toThrow(/immutable/);
  const timeline = new D1PositionPurchaseRepository(db.asD1());
  for (const id of [atlas.sourcePositionId, atlas.targetPositionId]) {
    const history = await timeline.history(LINK_DEMO_SUBJECT, id);
    expect(history.entries).toHaveLength(2);
    expect(history.entries.map((entry) => entry.receipt.id)).toContain(
      first.id,
    );
    expect(history.entries.every((entry) => entry.kind === "link")).toBe(true);
    expect(
      history.entries
        .map((entry) => entry.kind === "link" && entry.receipt.state)
        .sort(),
    ).toEqual(["linked", "unlinked"]);
  }
});
it("rejects self, foreign, stale, cyclic links and duplicate valuation sources", async () => {
  const atlas = await input("Demo Atlas AI source", "Demo Atlas II SPV");
  await expect(repo.accept("foreign-subject", atlas)).rejects.toThrow();
  await expect(
    repo.accept(LINK_DEMO_SUBJECT, {
      ...atlas,
      targetPositionId: atlas.sourcePositionId,
    }),
  ).rejects.toThrow();
  await expect(
    repo.accept(LINK_DEMO_SUBJECT, {
      ...atlas,
      expectedSourceSnapshotId: "stale",
    }),
  ).rejects.toThrow(/changed/);
  await repo.accept(LINK_DEMO_SUBJECT, atlas);
  await expect(
    repo.accept(
      LINK_DEMO_SUBJECT,
      await input("Demo Atlas II SPV", "Demo Atlas AI source"),
    ),
  ).rejects.toThrow(/group/);
  await expect(
    repo.accept(
      LINK_DEMO_SUBJECT,
      await input("Demo Atlas Separate SPV", "Demo Atlas II SPV"),
    ),
  ).rejects.toThrow(/already supplies/);
  await expect(
    repo.accept(
      LINK_DEMO_SUBJECT,
      await input("Demo Orbit V SPV", "Demo Orbit VII SPV", {
        relationship: "replaced",
      }),
    ),
  ).rejects.toThrow(/replaced/);
});

it("merges scoped link and investment history across tied timestamps and page boundaries", async () => {
  const atlas = await input("Demo Atlas AI source", "Demo Atlas II SPV", {
    useSourceValue: false,
  });
  const purchases = new D1PositionPurchaseRepository(db.asD1());
  const initial = await purchases.accept(
    LINK_DEMO_SUBJECT,
    atlas.targetPositionId,
    {
      expectedSnapshotId: atlas.expectedTargetSnapshotId,
      expectedReceiptId: null,
      details: { coversPosition: false, lots: [] },
    },
  );
  const insertLink = db.sqlite
    .prepare(`INSERT INTO holding_position_link_reviews
    (id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,
      source_participation_review_id,target_participation_review_id,prior_id,relationship,state,
      use_source_value,note,reviewer_user_id,accepted_at)
    VALUES(?,'hh_demo',?,?,?,?,NULL,NULL,
      (SELECT review_id FROM holding_position_link_heads WHERE source_position_id=?),
      'same_investment',?,0,'Synthetic timeline','usr_demo',?)`);
  const date = "2026-10-02T12:00:00.000Z";
  for (let i = 0; i < 120; i++)
    insertLink.run(
      `link-${String(i).padStart(3, "0")}`,
      atlas.sourcePositionId,
      atlas.targetPositionId,
      atlas.expectedSourceSnapshotId,
      atlas.expectedTargetSnapshotId,
      atlas.sourcePositionId,
      i % 2 ? "unlinked" : "linked",
      date,
    );
  // A saved predecessor outside a page and a cross-table ID tie both remain
  // unambiguous; chronology does not infer the causal predecessor.
  const tied = { ...initial, id: "link-059", acceptedAt: date };
  db.sqlite
    .prepare(
      `INSERT INTO holding_purchase_reviews
    (id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at)
    VALUES(?,'hh_demo',?,?,?,?, 'usr_demo',?)`,
    )
    .run(
      tied.id,
      tied.positionId,
      tied.snapshotId,
      initial.id,
      JSON.stringify(tied),
      date,
    );
  const orbit = await input(
    "Demo Orbit Aerospace source",
    "Demo Orbit VII SPV",
    { useSourceValue: false },
  );
  for (let i = 0; i < 120; i++)
    insertLink.run(
      `other-${i}`,
      orbit.sourcePositionId,
      orbit.targetPositionId,
      orbit.expectedSourceSnapshotId,
      orbit.expectedTargetSnapshotId,
      orbit.sourcePositionId,
      i % 2 ? "unlinked" : "linked",
      "2026-10-03T12:00:00.000Z",
    );
  let page = await purchases.history(LINK_DEMO_SUBJECT, atlas.targetPositionId);
  const entries = [...page.entries];
  while (page.next) {
    page = await purchases.history(
      LINK_DEMO_SUBJECT,
      atlas.targetPositionId,
      page.next,
    );
    entries.push(...page.entries);
  }
  expect(entries).toHaveLength(122);
  expect(new Set(entries.map((e) => `${e.kind}:${e.receipt.id}`)).size).toBe(
    122,
  );
  const revision = entries.find(
    (e) => e.kind === "investment" && e.receipt.id === tied.id,
  );
  expect(revision?.kind === "investment" && revision.previous?.id).toBe(
    initial.id,
  );
  expect(entries.filter((e) => e.kind === "link")).toHaveLength(120);
  expect(
    (await purchases.history("foreign-subject", atlas.targetPositionId))
      .entries,
  ).toEqual([]);
});
it("has projection-only bounded reads and indexed link lookups", async () => {
  await repo.accept(
    LINK_DEMO_SUBJECT,
    await input("Demo Atlas AI source", "Demo Atlas II SPV"),
  );
  db.queries.length = 0;
  const positions = await new D1InvestmentPositionViewRepository(
    db.asD1(),
  ).listForHousehold("hh_demo");
  expect(db.queries).toHaveLength(3);
  const query = db.statements.findLast((s) =>
    s.sql.includes("AS linked_value_json"),
  )!;
  const plan = db.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all("hh_demo");
  expect(plan.filter((r) => /SCAN link\b/.test(String(r.detail)))).toEqual([]);
  await new D1InvestmentExposureViewRepository(db.asD1()).listForHousehold(
    "hh_demo",
    positions.asOf,
    positions,
  );
  expect(db.queries.every((q) => !/^\s*(INSERT|UPDATE|DELETE)/i.test(q))).toBe(
    true,
  );
});

it("removes reviewed duplicate baseline contributions without rewriting prior baselines", async () => {
  const { D1PortfolioBaselineRepository, refreshAcceptedPortfolioBaseline } =
    await import("./portfolio-baseline");
  const baseline = new D1PortfolioBaselineRepository(db.asD1());
  const before = await baseline.getState(LINK_DEMO_SUBJECT);
  await baseline.confirm(LINK_DEMO_SUBJECT, {
    sourceRevision: before.sourceRevision!,
    baseForecastSnapshotId: before.baseForecastSnapshotId!,
    baseForecastSnapshotVersion: before.baseForecastSnapshotVersion!,
    changeNote: "Synthetic initial baseline",
    otherFiEligibleLiquidMinor: 0,
    duplicateReviewConfirmed: true,
    cashOverlapReviewConfirmed: true,
  });
  const prior = await baseline.getState(LINK_DEMO_SUBJECT);
  const originalId = prior.latestBaseline!.id;
  const countBefore = db.sqlite
    .prepare(
      "SELECT count(*) n FROM portfolio_baseline_items WHERE baseline_id=?",
    )
    .get(originalId)?.n;
  const link = await input("Demo Atlas AI source", "Demo Atlas II SPV");
  await repo.accept(LINK_DEMO_SUBJECT, link);
  const proposed = await baseline.getState(LINK_DEMO_SUBJECT);
  expect(
    proposed.exceptions?.some(
      (e) => e.key === `position:${link.sourcePositionId}`,
    ),
  ).toBe(false);
  expect(
    await refreshAcceptedPortfolioBaseline(baseline, LINK_DEMO_SUBJECT),
  ).toMatchObject({ status: "refreshed" });
  const refreshed = await baseline.getState(LINK_DEMO_SUBJECT);
  expect(refreshed.latestBaseline?.id).not.toBe(originalId);
  expect(
    db.sqlite
      .prepare(
        "SELECT count(*) n FROM portfolio_baseline_items WHERE baseline_id=?",
      )
      .get(originalId)?.n,
  ).toBe(countBefore);
  expect(
    db.sqlite
      .prepare(
        "SELECT count(*) n FROM portfolio_baseline_items WHERE baseline_id=? AND position_id=?",
      )
      .get(refreshed.latestBaseline!.id, link.sourcePositionId)?.n,
  ).toBe(0);
});

it("keeps a reviewed price on the provider identity when its visible linked holding is edited", async () => {
  const linked = await input("Demo Atlas AI source", "Demo Atlas II SPV");
  await repo.accept(LINK_DEMO_SUBJECT, linked);
  const purchases = new D1PositionPurchaseRepository(db.asD1());
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    LINK_DEMO_SUBJECT,
    "available",
  );
  const holding = page.holdings.find((h) => h.id === linked.targetPositionId)!;
  const record = {
    ...gpRecord(holding),
    priceMicros: 200_000_000,
    priceDate: "2026-09-10",
    shareClass: "Common",
    shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
    priceSourcePositionId: linked.sourcePositionId,
  };
  const first = await purchases.acceptValuation(
    LINK_DEMO_SUBJECT,
    linked.targetPositionId,
    {
      expectedSnapshotId: linked.expectedTargetSnapshotId,
      expectedReceiptId: null,
      record,
      method: "total",
    },
  );
  const quote = (
    await purchases.valuationEvidence(
      LINK_DEMO_SUBJECT,
      linked.targetPositionId,
    )
  ).prices.find((q) => q.positionId === linked.sourcePositionId)!;
  expect(quote).toMatchObject({
    markMicros: 200_000_000,
    markDate: "2026-09-10",
    sourceLabel: "Tokenfolio",
  });
  const second = await purchases.acceptValuation(
    LINK_DEMO_SUBJECT,
    linked.targetPositionId,
    {
      expectedSnapshotId: linked.expectedTargetSnapshotId,
      expectedReceiptId: first.id,
      record: {
        ...record,
        sourceEvidenceId: quote.id,
        sourcePositionId: quote.positionId,
        sourceCapturedAt: quote.capturedAt,
      },
      method: "total",
    },
  );
  expect(second.details.valuation!.records[0]!.totalMinor).toBe(4_200_000);
  expect(second.details.valuation!.records[0]!.effectiveDate).toBe(
    record.effectiveDate,
  );
  expect(
    db.sqlite
      .prepare(
        "SELECT source_position_id FROM holding_price_quotes WHERE review_id=?",
      )
      .get(first.id)?.source_position_id,
  ).toBe(linked.sourcePositionId);
});
