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
import { D1HoldingsPageRepository } from "./holdings-page";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
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
