import { afterEach, beforeEach, expect, it } from "vitest";
import {
  legalDocumentTestDatabase,
  LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import {
  ManualHoldingInputSchema,
  type ManualHoldingInput,
} from "@keel/domain/manual-holdings";
import { D1ManualHoldingRepository } from "./manual-holdings";
import { D1HoldingsPageRepository } from "./holdings-page";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { calculatePortfolioPerformance } from "../../domain/src/portfolio-performance";
import { D1PortfolioBaselineRepository } from "./portfolio-baseline";
import { D1PositionLinkRepository } from "./position-links";
import { seedPositionLinks } from "../../../scripts/seed-position-links";
import { D1InvestmentReviewRepository } from "./investment-review";
import { D1LegalEntityRepository } from "./legal-entities";
import { D1ExposureRepository } from "./exposures";
import type { LegalEntityProfileInput } from "@keel/domain/legal-entities";

class ManualTestD1 extends LegalDocumentTestD1 {
  override batch(statements: Parameters<LegalDocumentTestD1["batch"]>[0]) {
    const before = this.beforeBatch;
    this.beforeBatch = null;
    before?.();
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        /^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/iu.test(statement.sql)
          ? {
              success: true,
              results: this.sqlite
                .prepare(statement.sql)
                .all(...statement.values),
              meta: { changes: 0 },
            }
          : { ...statement.execute(), results: [] },
      );
      this.sqlite.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}
let db: ManualTestD1;
let repository: D1ManualHoldingRepository;
const subject = "synthetic-access-subject";
const objects = new Map<string, string>();
beforeEach(() => {
  const fixture = legalDocumentTestDatabase();
  db = new ManualTestD1(fixture.sqlite);
  objects.clear();
  repository = new D1ManualHoldingRepository(db.asD1(), {
    put: (key: string, value: unknown) => {
      objects.set(key, String(value));
      return Promise.resolve(null);
    },
  });
});
afterEach(() => db.sqlite.close());
function input(
  overrides: Partial<ManualHoldingInput> = {},
): ManualHoldingInput {
  return ManualHoldingInputSchema.parse({
    submissionId: crypto.randomUUID(),
    classification: "private_paper",
    name: "Synthetic Manual Investment",
    kind: "spv_interest",
    owner: { mode: "new", label: "Synthetic Personal Holdings" },
    company: { mode: "unassigned" },
    cashPaidMinor: null,
    investmentDate: null,
    valuation: { state: "unknown" },
    ...overrides,
  });
}
async function holding(positionId: string) {
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    subject,
    "configuration_required",
  );
  return { page, holding: page.holdings.find((row) => row.id === positionId)! };
}
it.each(["direct", "spv_interest", "fund_interest"] as const)(
  "creates an honest unknown-money %s and reuses its dated valuation editor",
  async (kind) => {
    const saved = await repository.create(subject, input({ kind }));
    const initial = await holding(saved.positionId);
    expect(initial.holding).toMatchObject({
      manualContext: { version: 1, classification: "private_paper" },
      sourceStatus: "manual",
      sourceLabel: "Entered by you",
      investedMinor: null,
      committedMinor: null,
      realizedValueMinor: null,
      administratorNavMinor: null,
    });
    expect(initial.holding.purchaseContext?.receipt?.details.lots).toEqual([]);
    const edited = await new D1PositionPurchaseRepository(
      db.asD1(),
    ).acceptValuation(subject, saved.positionId, {
      expectedSnapshotId: saved.snapshotId,
      expectedReceiptId: saved.purchaseReceiptId,
      method: "total",
      record: {
        id: "mine",
        origin: "judgment",
        totalMinor: 3000001,
        priceMicros: null,
        priceDate: null,
        effectiveDate: "2026-01-15",
        carryStatus: "before_carry",
        sourceLabel: "Entered by you",
        sourceUrl: null,
        sourceEvidenceId: null,
        sourcePositionId: null,
        sourceCapturedAt: null,
        shareClass: null,
        watchEvidenceId: null,
      },
    });
    const read = await holding(saved.positionId);
    expect(read.holding.purchaseContext?.receipt?.id).toBe(edited.id);
    expect(
      read.page.investmentHoldings.exposureView.positions.find(
        (row) => row.id === saved.positionId,
      ),
    ).toMatchObject({
      valueMinor: 3000001,
      valueEffectiveDate: "2026-01-15",
      investedMinor: null,
      committedMinor: null,
      realizedValueMinor: null,
    });
    expect(objects.size).toBe(1);
  },
);
it("keeps cash paid, valuation and unknown net capital/distributions distinct", async () => {
  const saved = await repository.create(
    subject,
    input({
      cashPaidMinor: 2500000,
      valuation: {
        state: "estimated",
        amountMinor: 3000000,
        effectiveDate: "2026-02-01",
        carryStatus: "before_carry",
      },
    }),
  );
  const read = await holding(saved.positionId);
  expect(read.holding).toMatchObject({
    investedMinor: 2500000,
    committedMinor: null,
    realizedValueMinor: null,
    administratorNavMinor: null,
  });
  expect(read.holding.purchaseContext?.receipt?.details).toMatchObject({
    lots: [{ grossCashMinor: 2500000, netCapitalMinor: null }],
    cashCoversPosition: false,
    valuation: {
      records: [
        {
          origin: "judgment",
          totalMinor: 3000000,
          effectiveDate: "2026-02-01",
        },
      ],
    },
  });
  const position = read.page.investmentHoldings.exposureView.positions.find(
    (row) => row.id === saved.positionId,
  )!;
  expect(position).toMatchObject({
    valueMinor: 3000000,
    committedMinor: null,
    realizedValueMinor: null,
  });
  const performance = calculatePortfolioPerformance(
    read.page.investmentHoldings,
    "USD",
  );
  expect(performance.holdingReturn.eligibleCount).toBe(0);
  const [key, body] = [...objects.entries()][0]!;
  expect(key).toContain(`manual-holdings/hh_demo/${saved.submissionId}/`);
  expect(ManualHoldingInputSchema.parse(JSON.parse(body))).toMatchObject({
    submissionId: saved.submissionId,
    cashPaidMinor: 2500000,
    investmentDate: null,
    valuation: {
      state: "estimated",
      amountMinor: 3000000,
      effectiveDate: "2026-02-01",
    },
  });
  const digest = [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  expect(
    db.sqlite
      .prepare(
        "SELECT object_key,sha256,effective_date,content_type,source_label,review_status FROM source_documents WHERE object_key=?",
      )
      .get(key),
  ).toMatchObject({
    object_key: key,
    sha256: digest,
    effective_date: null,
    content_type: "application/json",
    source_label: "Entered by you",
    review_status: "accepted",
  });
  expect(
    db.sqlite
      .prepare(
        "SELECT d.decision_source,d.reviewer_user_id FROM holding_import_applications a JOIN holding_import_row_decisions d ON d.id=a.decision_id WHERE a.position_id=?",
      )
      .get(saved.positionId),
  ).toMatchObject({ decision_source: "manual", reviewer_user_id: "usr_demo" });
  expect(
    await new D1InvestmentReviewRepository(db.asD1()).getContext(
      subject,
      saved.positionId,
    ),
  ).toMatchObject({
    committedMinor: null,
    sourceAmountMinor: 2500000,
    economics: null,
  });
});
it("does not turn known cash into a current valuation and retains an explicit zero", async () => {
  const saved = await repository.create(subject, input({ cashPaidMinor: 0 }));
  const read = await holding(saved.positionId);
  expect(read.holding.investedMinor).toBe(0);
  expect(
    read.page.investmentHoldings.exposureView.positions.find(
      (row) => row.id === saved.positionId,
    ),
  ).toMatchObject({ valueMinor: null, valueState: "not_reported" });
});
it("deduplicates exact submissions, conflicts changed payloads and keeps separate investments", async () => {
  const draft = input();
  const saved = await repository.create(subject, draft);
  expect(await repository.create(subject, draft)).toEqual(saved);
  expect(await repository.submission(subject, draft.submissionId)).toEqual(
    saved,
  );
  await expect(
    repository.create(subject, { ...draft, name: "Changed declaration" }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(await repository.submission(subject, crypto.randomUUID())).toBeNull();
  const other = await repository.create(subject, input());
  expect(other.positionId).not.toBe(saved.positionId);
  expect(
    db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM holding_positions WHERE provider='manual'",
      )
      .get()!.n,
  ).toBe(2);
});
it("preserves household isolation for the same UUID and declaration", async () => {
  db.sqlite.exec(
    "INSERT INTO users(id,access_subject,email,display_name,created_at) VALUES('manual_other_user','manual-other-subject','manual-other@example.test','Synthetic Other','2026-01-01T00:00:00.000Z'); INSERT INTO households(id,owner_user_id,name,base_currency,created_at) VALUES('manual_other_household','manual_other_user','Synthetic Other','USD','2026-01-01T00:00:00.000Z')",
  );
  const draft = input();
  const first = await repository.create(subject, draft);
  const second = await repository.create("manual-other-subject", draft);
  expect(first.positionId).not.toBe(second.positionId);
  expect(objects.size).toBe(2);
  expect(
    await repository.submission("manual-other-subject", draft.submissionId),
  ).toEqual(second);
  const options = await repository.options("manual-other-subject");
  expect(options.containers).toHaveLength(1);
  await expect(
    repository.create(
      "manual-other-subject",
      input({
        owner: {
          mode: "existing",
          containerId: (await repository.options(subject)).containers[0]!.id,
          version: 1,
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "stale" });
});
it("appends identity and ownership revisions without changing money or accepted source facts", async () => {
  const saved = await repository.create(
    subject,
    input({ cashPaidMinor: 2500000 }),
  );
  const original = db.sqlite
    .prepare("SELECT * FROM holding_positions WHERE id=?")
    .get(saved.positionId);
  const revised = await repository.reviseIdentity(subject, saved.positionId, {
    submissionId: crypto.randomUUID(),
    expectedVersion: 1,
    expectedMappingIds: [],
    name: "Synthetic Corrected Fund",
    kind: "fund_interest",
    owner: { mode: "new", label: "Synthetic New Owner" },
    company: { mode: "unassigned" },
    investmentDate: null,
  });
  expect(revised.identityVersion).toBe(2);
  expect(
    db.sqlite
      .prepare("SELECT * FROM holding_positions WHERE id=?")
      .get(saved.positionId),
  ).toEqual(original);
  const read = await holding(saved.positionId);
  expect(read.holding).toMatchObject({
    positionName: "Synthetic Corrected Fund",
    positionKind: "fund_interest",
    ownerLabel: "Synthetic New Owner",
    investedMinor: 2500000,
    manualContext: { version: 2 },
  });
  await expect(
    repository.reviseIdentity(subject, saved.positionId, {
      submissionId: crypto.randomUUID(),
      expectedVersion: 1,
      expectedMappingIds: [],
      name: "Stale change",
      kind: "direct",
      owner: { mode: "new", label: "Synthetic New Owner" },
      company: { mode: "unassigned" },
      investmentDate: null,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  expect(db.sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  const history = await new D1PositionPurchaseRepository(db.asD1()).history(
    subject,
    saved.positionId,
  );
  const identities = history.entries.filter(
    (entry) => entry.kind === "identity",
  );
  expect(identities).toHaveLength(2);
  expect(
    identities.find(
      (entry) => entry.receipt.value.name === "Synthetic Corrected Fund",
    ),
  ).toMatchObject({
    receipt: {
      value: {
        name: "Synthetic Corrected Fund",
        kind: "fund_interest",
        ownerLabel: "Synthetic New Owner",
        companies: [],
      },
    },
    previous: {
      name: "Synthetic Manual Investment",
      kind: "spv_interest",
      ownerLabel: "Synthetic Personal Holdings",
      companies: [],
    },
  });
  expect(
    identities.find((entry) => entry.previous === null)?.receipt.value.name,
  ).toBe("Synthetic Manual Investment");
});
it("rolls back every accepted record when a current owner version races", async () => {
  const initial = await repository.create(subject, input());
  const owner = (await repository.options(subject)).containers[0]!;
  const before = db.sqlite
    .prepare("SELECT COUNT(*) n FROM holding_positions WHERE provider='manual'")
    .get()!.n;
  db.beforeBatch = () =>
    db.sqlite.exec(
      `INSERT INTO ownership_container_versions(id,household_id,container_id,version,display_label,container_kind,tax_treatment,supersedes_version_id,recorded_by_user_id,recorded_at,immutable) SELECT id||'_race',household_id,container_id,version+1,display_label,container_kind,tax_treatment,id,recorded_by_user_id,'2099-01-01T00:00:00.000Z',1 FROM ownership_container_versions WHERE container_id='${owner.id}' AND version=1`,
    );
  await expect(
    repository.create(
      subject,
      input({
        owner: {
          mode: "existing",
          containerId: owner.id,
          version: owner.version,
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "stale" });
  expect(
    db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM holding_positions WHERE provider='manual'",
      )
      .get()!.n,
  ).toBe(before);
  expect(await repository.submission(subject, initial.submissionId)).toEqual(
    initial,
  );
});
it("converges concurrent same-key requests and rejects a changed-payload winner", async () => {
  const draft = input();
  const exact = await Promise.all([
    repository.create(subject, draft),
    repository.create(subject, draft),
  ]);
  expect(exact[0]).toEqual(exact[1]);
  const changed = input();
  const race = await Promise.allSettled([
    repository.create(subject, changed),
    repository.create(subject, {
      ...changed,
      name: "Synthetic Different Payload",
    }),
  ]);
  expect(race.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  expect(race.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "conflict" },
  });
  expect(
    db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM holding_positions WHERE provider='manual'",
      )
      .get()!.n,
  ).toBe(2);
  expect(
    db.sqlite
      .prepare("SELECT COUNT(*) n FROM manual_holding_submissions")
      .get()!.n,
  ).toBe(2);
});
it("keeps separate same-company SPVs and rejects a company revision raced during acceptance", async () => {
  const company = (await repository.options(subject)).companies[0]!;
  const first = await repository.create(
    subject,
    input({
      name: "Synthetic Vehicle I",
      company: {
        mode: "existing",
        companyId: company.id,
        revision: company.revision,
      },
    }),
  );
  const second = await repository.create(
    subject,
    input({
      name: "Synthetic Vehicle II",
      company: {
        mode: "existing",
        companyId: company.id,
        revision: company.revision,
      },
    }),
  );
  const page = (await holding(first.positionId)).page;
  expect(
    page.holdings.filter(
      (row) => row.id === first.positionId || row.id === second.positionId,
    ),
  ).toHaveLength(2);
  expect(
    page.investmentHoldings.exposureView.positions.filter(
      (row) => row.id === first.positionId || row.id === second.positionId,
    ),
  ).toHaveLength(2);
  const before = db.sqlite
    .prepare("SELECT COUNT(*) n FROM manual_holding_submissions")
    .get()!.n;
  db.beforeBatch = () =>
    db.sqlite
      .prepare(
        "UPDATE companies SET updated_at='2099-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(company.id);
  await expect(
    repository.create(
      subject,
      input({
        company: {
          mode: "existing",
          companyId: company.id,
          revision: company.revision,
        },
      }),
    ),
  ).rejects.toMatchObject({ code: "stale" });
  expect(
    db.sqlite
      .prepare("SELECT COUNT(*) n FROM manual_holding_submissions")
      .get()!.n,
  ).toBe(before);
});
it("projects explicit private-paper planning and preserves its accepted baseline after later edits", async () => {
  const baseline = new D1PortfolioBaselineRepository(db.asD1());
  const saved = await repository.create(
    subject,
    input({
      valuation: {
        state: "estimated",
        amountMinor: 3000000,
        effectiveDate: "2026-02-01",
        carryStatus: "after_carry",
      },
    }),
  );
  expect(
    db.sqlite.prepare("SELECT COUNT(*) n FROM portfolio_baselines").get()!.n,
  ).toBe(0);
  const state = await baseline.getState(subject);
  expect(
    state.positions.find((row) => row.id === saved.positionId),
  ).toMatchObject({
    provider: "manual",
    classification: "private_paper",
    valueMinor: 3000000,
  });
  expect(state.summary).toMatchObject({
    publicMarketValueMinor: 0,
    privatePaperValueMinor: 3000000,
  });
  if (
    !state.sourceRevision ||
    !state.baseForecastSnapshotId ||
    !state.baseForecastSnapshotVersion
  )
    throw new Error("Expected synthetic baseline proposal");
  const accepted = await baseline.confirm(subject, {
    sourceRevision: state.sourceRevision,
    baseForecastSnapshotId: state.baseForecastSnapshotId,
    baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
    otherFiEligibleLiquidMinor: state.planning.currentFiEligibleLiquidMinor,
    duplicateReviewConfirmed: false,
    cashOverlapReviewConfirmed: false,
    changeNote: "Synthetic manual planning review",
  });
  expect(accepted.baseline.fiEligibleLiquidMinor).toBe(
    state.planning.currentFiEligibleLiquidMinor,
  );
  const oldItems = db.sqlite
    .prepare("SELECT * FROM portfolio_baseline_items WHERE baseline_id=?")
    .all(accepted.baseline.id);
  await repository.reviseIdentity(subject, saved.positionId, {
    submissionId: crypto.randomUUID(),
    expectedVersion: 1,
    expectedMappingIds: [],
    name: "Synthetic Revised Identity",
    kind: "direct",
    owner: {
      mode: "existing",
      containerId: (await repository.options(subject)).containers[0]!.id,
      version: 1,
    },
    company: { mode: "unassigned" },
    investmentDate: null,
  });
  expect(
    db.sqlite
      .prepare("SELECT * FROM portfolio_baseline_items WHERE baseline_id=?")
      .all(accepted.baseline.id),
  ).toEqual(oldItems);
  expect(
    db.sqlite
      .prepare(
        "SELECT provider,classification FROM portfolio_baseline_items WHERE position_id=?",
      )
      .get(saved.positionId),
  ).toMatchObject({ provider: "manual", classification: "private_paper" });
});
it("supports explicit manual overlap resolution while retaining both evidence histories", async () => {
  await seedPositionLinks(db.asD1());
  const manual = await repository.create(
    subject,
    input({
      kind: "direct",
      valuation: {
        state: "estimated",
        amountMinor: 3000000,
        effectiveDate: "2026-02-01",
        carryStatus: "unknown",
      },
    }),
  );
  const links = new D1PositionLinkRepository(db.asD1());
  const workspace = await links.workspace(subject);
  const source = workspace.positions.find(
    (row) => row.legalVehicleName === "Demo Atlas AI source",
  )!;
  const target = workspace.positions.find(
    (row) => row.id === manual.positionId,
  )!;
  const declaration = {
    sourcePositionId: source.id,
    targetPositionId: target.id,
    expectedSourceSnapshotId: source.snapshot.id,
    expectedTargetSnapshotId: target.snapshot.id,
    expectedSourceParticipationReviewId: source.investmentReview?.id ?? null,
    expectedTargetParticipationReviewId: target.investmentReview?.id ?? null,
    expectedReviewId: null,
    relationship: "same_investment" as const,
    state: "linked" as const,
    useSourceValue: false,
    note: "Synthetic explicitly reviewed overlap",
  };
  await links.accept(subject, declaration);
  const page = (await holding(manual.positionId)).page;
  expect(page.holdings.some((row) => row.id === source.id)).toBe(false);
  expect(
    page.holdings.find((row) => row.id === manual.positionId)
      ?.administratorNavMinor,
  ).toBeNull();
  for (const id of [source.id, manual.positionId]) {
    expect(
      (
        await new D1PositionPurchaseRepository(db.asD1()).history(subject, id)
      ).entries.some((entry) => entry.kind === "link"),
    ).toBe(true);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM holding_position_snapshots WHERE position_id=?",
        )
        .get(id)!.n,
    ).toBe(1);
  }
  const another = await repository.create(subject, input());
  const after = await links.workspace(subject);
  const other = after.positions.find((row) => row.id === another.positionId)!;
  await expect(
    links.accept(subject, {
      ...declaration,
      sourcePositionId: another.positionId,
      targetPositionId: source.id,
      expectedSourceSnapshotId: other.snapshot.id,
      expectedTargetSnapshotId: source.snapshot.id,
      useSourceValue: true,
    }),
  ).rejects.toThrow(/manual estimate/);
});
it("versions the same-company mapping when correcting Direct to Fund", async () => {
  const company = (await repository.options(subject)).companies[0]!;
  const selected = {
    mode: "existing" as const,
    companyId: company.id,
    revision: company.revision,
  };
  const saved = await repository.create(
    subject,
    input({ kind: "direct", company: selected }),
  );
  const old = db.sqlite
    .prepare(
      "SELECT * FROM holding_position_exposure_mappings WHERE position_id=?",
    )
    .all(saved.positionId);
  await repository.reviseIdentity(subject, saved.positionId, {
    submissionId: crypto.randomUUID(),
    expectedVersion: 1,
    expectedMappingIds: old.map((row) => String(row.id)),
    name: "Synthetic Corrected Fund",
    kind: "fund_interest",
    owner: {
      mode: "existing",
      containerId: (await repository.options(subject)).containers[0]!.id,
      version: 1,
    },
    company: selected,
    investmentDate: null,
  });
  const mappings = db.sqlite
    .prepare(
      "SELECT relationship_kind,version,supersedes_mapping_id,status FROM holding_position_exposure_mappings WHERE position_id=? ORDER BY version",
    )
    .all(saved.positionId);
  expect(mappings).toEqual([
    {
      relationship_kind: "direct",
      version: 1,
      supersedes_mapping_id: null,
      status: "active",
    },
    {
      relationship_kind: "look_through",
      version: 2,
      supersedes_mapping_id: old[0]!.id,
      status: "active",
    },
  ]);
  const read = (await holding(saved.positionId)).holding;
  expect(read).toMatchObject({
    positionKind: "fund_interest",
    instrumentType: "Private fund interest",
  });
  expect(
    db.sqlite
      .prepare(
        "SELECT instrument_type FROM holding_position_snapshots WHERE id=?",
      )
      .get(saved.snapshotId),
  ).toMatchObject({ instrument_type: "Direct private investment" });
});
it.each(["direct", "spv_interest", "fund_interest"] as const)(
  "rejects a %s identity draft after canonical company grouping changes",
  async (kind) => {
    const companies = (await repository.options(subject)).companies;
    const first = companies[0]!;
    const second = companies[1]!;
    const saved = await repository.create(
      subject,
      input({
        kind,
        company: {
          mode: "existing",
          companyId: first.id,
          revision: first.revision,
        },
      }),
    );
    const draft = (await holding(saved.positionId)).holding;
    const reviews = new D1InvestmentReviewRepository(db.asD1());
    const context = await reviews.getContext(subject, saved.positionId);
    await reviews.reviewCompany(subject, saved.positionId, {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: context.snapshotId,
      expectedEvidenceRevision: context.evidenceRevision,
      expectedMappingIds: context.mappings.map((mapping) => mapping.id),
      company: { mode: "existing", companyId: second.id },
      basis: "user_confirmed",
      citation: null,
      reason: null,
    });
    const current = (await holding(saved.positionId)).holding;
    expect(current.companyId).toBe(second.id);
    const count = db.sqlite
      .prepare(
        "SELECT COUNT(*) n FROM manual_holding_identity_versions WHERE position_id=?",
      )
      .get(saved.positionId)!.n;
    await expect(
      repository.reviseIdentity(subject, saved.positionId, {
        submissionId: crypto.randomUUID(),
        expectedVersion: draft.manualContext!.version,
        expectedMappingIds: draft.manualContext!.companyMappingIds,
        name: "Synthetic Stale Rename",
        kind,
        owner: {
          mode: "existing",
          containerId: draft.manualContext!.containerId,
          version: draft.manualContext!.containerVersion,
        },
        company: {
          mode: "existing",
          companyId: first.id,
          revision: first.revision,
        },
        investmentDate: null,
      }),
    ).rejects.toMatchObject({ code: "stale" });
    expect((await holding(saved.positionId)).holding).toEqual(current);
    expect(
      db.sqlite
        .prepare(
          "SELECT COUNT(*) n FROM manual_holding_identity_versions WHERE position_id=?",
        )
        .get(saved.positionId)!.n,
    ).toBe(count);
  },
);
it("keeps a fund's selected underlying company allocation unknown", async () => {
  const company = (await repository.options(subject)).companies[0]!;
  const saved = await repository.create(
    subject,
    input({
      kind: "fund_interest",
      company: {
        mode: "existing",
        companyId: company.id,
        revision: company.revision,
      },
      valuation: {
        state: "estimated",
        amountMinor: 3000000,
        effectiveDate: "2026-02-01",
        carryStatus: "after_carry",
      },
    }),
  );
  const read = (await holding(saved.positionId)).page;
  const position = read.investmentHoldings.exposureView.positions.find(
    (row) => row.id === saved.positionId,
  )!;
  expect(position).toMatchObject({
    valueMinor: 3000000,
    knownAllocationPpm: 0,
    hasUnknownAllocation: true,
    allocatedValueMinor: 0,
    unallocatedValueMinor: 3000000,
    mappings: [{ allocationPpm: null }],
  });
  const group = read.investmentHoldings.exposureView.exposures.find(
    (row) => row.exposure.companyId === company.id,
  )!;
  expect(group.contributions).toEqual([
    expect.objectContaining({
      positionId: saved.positionId,
      allocationPpm: null,
      allocatedValueMinor: null,
    }),
  ]);
  expect(group.totals).toEqual([
    expect.objectContaining({
      allocatedValueMinor: 0,
      unknownValuePositionCount: 1,
    }),
  ]);
});
it("preserves two reviewed company mappings through an unrelated identity edit", async () => {
  const saved = await repository.create(
    subject,
    input({ kind: "fund_interest" }),
  );
  const exposures = new D1ExposureRepository(db.asD1());
  const companies = (await repository.options(subject)).companies.slice(0, 2);
  for (const company of companies) {
    const exposure = await exposures.resolveExposure(subject, {
      exposureKind: "private_company",
      canonicalName: company.name,
      companyId: company.id,
      evidenceSha256: "a".repeat(64),
    });
    await exposures.recordMapping(subject, {
      positionId: saved.positionId,
      exposureId: exposure.id,
      relationshipKind: "look_through",
      allocationPpm: null,
      status: "active",
      decisionSource: "review",
      decisionReference: "Synthetic multi-company fund",
      evidenceSha256: "b".repeat(64),
      effectiveAt: new Date().toISOString(),
    });
  }
  const draft = (await holding(saved.positionId)).holding;
  expect(draft.companyId).toBeNull();
  expect(draft.manualContext!.companyMappingIds).toHaveLength(2);
  const old = db.sqlite
    .prepare(
      "SELECT * FROM holding_position_exposure_heads WHERE position_id=? ORDER BY exposure_id",
    )
    .all(saved.positionId);
  await repository.reviseIdentity(subject, saved.positionId, {
    submissionId: crypto.randomUUID(),
    expectedVersion: draft.manualContext!.version,
    expectedMappingIds: draft.manualContext!.companyMappingIds,
    name: "Synthetic Corrected Fund Name",
    kind: "fund_interest",
    owner: {
      mode: "existing",
      containerId: draft.manualContext!.containerId,
      version: draft.manualContext!.containerVersion,
    },
    company: { mode: "unchanged" },
    investmentDate: null,
  });
  expect(
    db.sqlite
      .prepare(
        "SELECT * FROM holding_position_exposure_heads WHERE position_id=? ORDER BY exposure_id",
      )
      .all(saved.positionId),
  ).toEqual(old);
  expect((await holding(saved.positionId)).holding.positionName).toBe(
    "Synthetic Corrected Fund Name",
  );
});
it.each(["fund_interest", "spv_interest"] as const)(
  "preserves a reviewed partial %s allocation through a name-only correction",
  async (kind) => {
    const company = (await repository.options(subject)).companies[0]!;
    const saved = await repository.create(
      subject,
      input({
        kind,
        company: {
          mode: "existing",
          companyId: company.id,
          revision: company.revision,
        },
      }),
    );
    const head = db.sqlite
      .prepare(
        "SELECT exposure_id FROM holding_position_exposure_heads WHERE position_id=? AND status='active'",
      )
      .get(saved.positionId)!;
    await new D1ExposureRepository(db.asD1()).recordMapping(subject, {
      positionId: saved.positionId,
      exposureId: String(head.exposure_id),
      relationshipKind: "look_through",
      allocationPpm: 400000,
      status: "active",
      decisionSource: "review",
      decisionReference: "Synthetic supported partial company exposure",
      evidenceSha256: "c".repeat(64),
      effectiveAt: new Date().toISOString(),
    });
    const draft = (await holding(saved.positionId)).holding;
    expect(draft.companyId).toBe(company.id);
    expect(draft.manualContext!.companyMappingIds).toHaveLength(1);
    const before = db.sqlite
      .prepare(
        "SELECT * FROM holding_position_exposure_heads WHERE position_id=?",
      )
      .all(saved.positionId);
    await repository.reviseIdentity(subject, saved.positionId, {
      submissionId: crypto.randomUUID(),
      expectedVersion: 1,
      expectedMappingIds: draft.manualContext!.companyMappingIds,
      name: "Synthetic Name Only Correction",
      kind,
      owner: {
        mode: "existing",
        containerId: draft.manualContext!.containerId,
        version: draft.manualContext!.containerVersion,
      },
      company: { mode: "unchanged" },
      investmentDate: null,
    });
    expect(
      db.sqlite
        .prepare(
          "SELECT * FROM holding_position_exposure_heads WHERE position_id=?",
        )
        .all(saved.positionId),
    ).toEqual(before);
    expect(
      db.sqlite
        .prepare(
          "SELECT allocation_ppm FROM holding_position_exposure_mappings WHERE id=?",
        )
        .get(draft.manualContext!.companyMappingIds[0]!),
    ).toMatchObject({ allocation_ppm: 400000 });
  },
);
it.each(["direct", "spv_interest"] as const)(
  "withholds inferred whole-company allocation when correcting %s to Fund with unchanged grouping",
  async (kind) => {
    const company = (await repository.options(subject)).companies[0]!;
    const saved = await repository.create(
      subject,
      input({
        kind,
        company: {
          mode: "existing",
          companyId: company.id,
          revision: company.revision,
        },
        valuation: {
          state: "estimated",
          amountMinor: 3000000,
          effectiveDate: "2026-02-01",
          carryStatus: "after_carry",
        },
      }),
    );
    const draft = (await holding(saved.positionId)).holding;
    await repository.reviseIdentity(subject, saved.positionId, {
      submissionId: crypto.randomUUID(),
      expectedVersion: 1,
      expectedMappingIds: draft.manualContext!.companyMappingIds,
      name: draft.positionName,
      kind: "fund_interest",
      owner: {
        mode: "existing",
        containerId: draft.manualContext!.containerId,
        version: draft.manualContext!.containerVersion,
      },
      company: { mode: "unchanged" },
      investmentDate: null,
    });
    const head = db.sqlite
      .prepare(
        "SELECT m.relationship_kind,m.allocation_ppm,m.version,m.supersedes_mapping_id FROM holding_position_exposure_heads h JOIN holding_position_exposure_mappings m ON m.id=h.mapping_id WHERE h.position_id=? AND h.status='active'",
      )
      .get(saved.positionId);
    expect(head).toMatchObject({
      relationship_kind: "look_through",
      allocation_ppm: null,
      version: 2,
      supersedes_mapping_id: draft.manualContext!.companyMappingIds[0],
    });
    const current = (
      await holding(saved.positionId)
    ).page.investmentHoldings.exposureView.positions.find(
      (row) => row.id === saved.positionId,
    )!;
    expect(current).toMatchObject({
      positionKind: "fund_interest",
      hasUnknownAllocation: true,
      knownAllocationPpm: 0,
      allocatedValueMinor: 0,
      unallocatedValueMinor: 3000000,
    });
  },
);
it("records actual prior and new company groupings in chronological identity history", async () => {
  const [first, second] = (await repository.options(subject)).companies;
  const saved = await repository.create(
    subject,
    input({
      company: {
        mode: "existing",
        companyId: first!.id,
        revision: first!.revision,
      },
    }),
  );
  const draft = (await holding(saved.positionId)).holding;
  await repository.reviseIdentity(subject, saved.positionId, {
    submissionId: crypto.randomUUID(),
    expectedVersion: 1,
    expectedMappingIds: draft.manualContext!.companyMappingIds,
    name: "Synthetic Company Correction",
    kind: "spv_interest",
    owner: {
      mode: "existing",
      containerId: draft.manualContext!.containerId,
      version: draft.manualContext!.containerVersion,
    },
    company: {
      mode: "existing",
      companyId: second!.id,
      revision: second!.revision,
    },
    investmentDate: null,
  });
  const history = await new D1PositionPurchaseRepository(db.asD1()).history(
    subject,
    saved.positionId,
  );
  expect(
    history.entries.find(
      (entry) => entry.kind === "identity" && entry.previous !== null,
    ),
  ).toMatchObject({
    receipt: { value: { companies: [{ id: second!.id, name: second!.name }] } },
    previous: { companies: [{ id: first!.id, name: first!.name }] },
  });
});
it("versions a manual owner when an explicitly selected entity has been renamed", async () => {
  const entity = (await repository.options(subject)).legalEntities[0]!;
  const first = await repository.create(
    subject,
    input({
      owner: { mode: "entity", entityId: entity.id, version: entity.version },
    }),
  );
  const previous = (await holding(first.positionId)).holding;
  const identities = db.sqlite
    .prepare(
      "SELECT * FROM manual_holding_identity_versions WHERE position_id=?",
    )
    .all(first.positionId);
  const legal = new D1LegalEntityRepository(db.asD1());
  const current = (
    await legal.getState(subject, {
      asOf: new Date().toISOString(),
      connections: [],
    })
  ).entities.find((row) => row.id === entity.id)!;
  const profile: LegalEntityProfileInput = {
    legalName: "Synthetic Renamed Owner LLC",
    entityType: current.entityType,
    relationship: current.relationship,
    currentOwner: current.currentOwner,
    jurisdiction: current.jurisdiction,
    formedOn: current.formedOn,
    einLastFour: current.einLastFour,
    ownershipInterestPpm: current.ownershipInterestPpm,
    interestStatus: current.interestStatus,
    taxClassification: current.taxClassification,
    notes: current.notes,
  };
  const renamed = await legal.update(subject, entity.id, {
    expectedVersionId: current.versionId,
    profile,
  });
  await expect(
    repository.create(
      subject,
      input({
        owner: { mode: "entity", entityId: entity.id, version: entity.version },
      }),
    ),
  ).rejects.toMatchObject({ code: "stale" });
  const next = await repository.create(
    subject,
    input({
      owner: { mode: "entity", entityId: entity.id, version: renamed.version },
    }),
  );
  const read = (await holding(next.positionId)).holding;
  expect(read.ownerLabel).toBe(profile.legalName);
  expect(read.manualContext).toMatchObject({
    containerId: previous.manualContext!.containerId,
    containerVersion: 2,
  });
  expect(
    db.sqlite
      .prepare(
        "SELECT * FROM manual_holding_identity_versions WHERE position_id=?",
      )
      .all(first.positionId),
  ).toEqual(identities);
  expect(
    db.sqlite
      .prepare(
        "SELECT display_label FROM ownership_container_versions WHERE container_id=? AND version=1",
      )
      .get(read.manualContext!.containerId),
  ).toMatchObject({ display_label: entity.label });
});
