import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type StatementSync,
} from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { D1AlphaRepository } from "./index";
import {
  D1PortfolioWatchRepository,
  PortfolioWatchObservationInputSchema,
} from "./portfolio-watch";

const migrationFiles = [
  "packages/database/migrations/0001_keel_core.sql",
  "packages/database/migrations/0002_versioned_goals.sql",
  "packages/database/migrations/0003_evidence_applications.sql",
  "packages/database/migrations/0004_portfolio_watch.sql",
  "packages/database/migrations/0005_portfolio_watch_sources.sql",
  "packages/database/migrations/0006_evidence_claim_integrity.sql",
  "packages/database/migrations/0007_holding_imports.sql",
  "packages/database/migrations/0008_signal_update_proposals.sql",
  "packages/database/migrations/0009_angellist_mac_agent.sql",
  "packages/database/seed/synthetic.sql",
] as const;

class TestD1Statement {
  private bindings: SQLInputValue[] = [];

  public constructor(private readonly statement: StatementSync) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    this.bindings = values;
    return this;
  }

  public first<T>(columnName?: string): Promise<T | null> {
    const row = this.statement.get(...this.bindings);
    if (row === undefined) {
      return Promise.resolve(null);
    }
    return Promise.resolve(
      (columnName === undefined ? row : row[columnName]) as T,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.statement.all(...this.bindings) as unknown as T[],
    });
  }

  public execute(): { success: true } {
    this.statement.run(...this.bindings);
    return { success: true };
  }
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(query: string): TestD1Statement {
    return new TestD1Statement(this.database.prepare(query));
  }

  public batch(
    statements: readonly TestD1Statement[],
  ): Promise<{ success: true }[]> {
    this.database.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.execute());
      this.database.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createTestDatabase(): DatabaseSync {
  const database = new DatabaseSync(":memory:");
  for (const file of migrationFiles) {
    database.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
  }
  database.exec(`
    INSERT INTO portfolio_watch_sources (
      id, household_id, watch_target_id, company_id, source_kind, source_class,
      canonical_url, allowed_origin, allowed_path_prefix, status,
      authority_ppm, identity_confidence_ppm, operational_health_ppm,
      coverage_json, auto_activated_at, created_at, updated_at
    ) VALUES (
      'source_financing_test', 'hh_demo', 'watch_northstar', 'co_northstar',
      'official_company_web', 'official_company',
      'https://northstar-robotics.example/news',
      'https://northstar-robotics.example', '/', 'active',
      1000000, 1000000, 1000000, '{}',
      '2026-08-07T00:00:00Z', '2026-08-07T00:00:00Z',
      '2026-08-07T00:00:00Z'
    );
  `);
  return database;
}

function tableSnapshot(database: DatabaseSync, table: string): string {
  return JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all());
}

let database: DatabaseSync | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe("Portfolio Watch financing fact persistence", () => {
  it("round-trips typed facts through evidence JSON without applying financial changes", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database);
    const watchRepository = new D1PortfolioWatchRepository(
      d1 as unknown as D1Database,
    );
    const lotsBefore = tableSnapshot(database, "asset_lots");
    const marksBefore = tableSnapshot(database, "marks");
    const forecastsBefore = tableSnapshot(database, "forecast_snapshots");
    const applicationsBefore = tableSnapshot(database, "evidence_applications");

    const financingFacts = {
      roundType: "series" as const,
      roundLabel: "Series C",
      instrument: "mixed" as const,
      announcedAmount: {
        amountMinor: 125_000_000_00,
        currency: "USD",
        qualifier: "exact" as const,
        evidenceText: "The company announced US$125 million in new funding.",
      },
      companyValuation: {
        amountMinor: 1_250_000_000_00,
        currency: "USD",
        qualifier: "approximately" as const,
        evidenceText: "The round values the company at about US$1.25 billion.",
        basis: "post_money" as const,
      },
      ambiguities: ["combined_tranches" as const],
    };
    const recorded = await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/document-sha",
      contentType: "text/html",
      byteSize: 4_096,
      sha256: "a".repeat(64),
      retrievedAt: "2026-08-07T12:00:00Z",
      sourceUrl: "https://northstar-robotics.example/news/series-c",
      sourceTitle: "Northstar Robotics announces Series C",
      publishedAt: "2026-08-07T10:00:00Z",
      eventType: "financing_announced",
      observedFact:
        "Northstar Robotics announced a Series C financing. The company announced US$125 million in new funding. The round values the company at about US$1.25 billion.",
      modelConfidencePpm: 940_000,
      financingFacts,
      fingerprint: "b".repeat(64),
    });

    expect(recorded).toBe(true);
    const claim = database
      .prepare(
        `SELECT claim.field_path, claim.claim_value_json
         FROM evidence_claims claim
         JOIN evidence_events event ON event.id = claim.evidence_event_id
         WHERE event.headline = ?`,
      )
      .get("Northstar Robotics announces Series C") as {
      field_path: string;
      claim_value_json: string;
    };
    expect(claim.field_path).toBe("company_event.financing_terms");
    expect(JSON.parse(claim.claim_value_json)).toMatchObject({
      financingFacts,
    });

    const storedObservation = database
      .prepare(
        `SELECT valuation_low_minor, valuation_middle_minor,
                valuation_high_minor
         FROM public_source_observations WHERE fingerprint = ?`,
      )
      .get("b".repeat(64));
    expect(storedObservation).toEqual({
      valuation_low_minor: null,
      valuation_middle_minor: null,
      valuation_high_minor: null,
    });

    const alphaRepository = new D1AlphaRepository(d1 as unknown as D1Database);
    const alphaData = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const inboxItem = alphaData.evidenceInbox.find(
      (item) => item.headline === "Northstar Robotics announces Series C",
    );
    const observation = alphaData.portfolioWatch.observations.find(
      (item) => item.sourceTitle === "Northstar Robotics announces Series C",
    );
    expect(inboxItem).toMatchObject({
      status: "pending_review",
      confidencePpm: 1_000_000,
      modelConfidencePpm: 940_000,
      sourceUrl: "https://northstar-robotics.example/news/series-c",
      sourceExcerpt: "The company announced US$125 million in new funding.",
      forecastImpactMinor: 0,
      financingFacts,
      application: null,
    });
    expect(observation).toMatchObject({
      financingFacts,
      valuationLowMinor: null,
      valuationMiddleMinor: null,
      valuationHighMinor: null,
    });
    if (inboxItem === undefined) {
      throw new Error("Expected the financing evidence inbox item.");
    }
    await expect(
      alphaRepository.applyEvidence("synthetic-access-subject", inboxItem.id),
    ).rejects.toThrow("no deterministic direct application");
    expect(
      alphaData.evidenceInbox.find((item) => item.id === "evt_northstar_round"),
    ).toMatchObject({
      financingFacts: null,
      sourceUrl: null,
      sourceExcerpt: null,
    });

    expect(tableSnapshot(database, "asset_lots")).toBe(lotsBefore);
    expect(tableSnapshot(database, "marks")).toBe(marksBefore);
    expect(tableSnapshot(database, "forecast_snapshots")).toBe(forecastsBefore);
    expect(tableSnapshot(database, "evidence_applications")).toBe(
      applicationsBefore,
    );
  });

  it("creates an append-only proposal against exact signal and scenario versions", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database);
    const watchRepository = new D1PortfolioWatchRepository(
      d1 as unknown as D1Database,
    );
    const alphaRepository = new D1AlphaRepository(d1 as unknown as D1Database);
    const valuationEvidence =
      "The Series C values Northstar Robotics at USD 1 billion post-money.";
    const financingFacts = {
      roundType: "series" as const,
      roundLabel: "Series C",
      instrument: "equity" as const,
      announcedAmount: null,
      companyValuation: {
        amountMinor: 100_000_000_000,
        currency: "USD",
        qualifier: "exact" as const,
        evidenceText: valuationEvidence,
        basis: "post_money" as const,
      },
      ambiguities: [],
    };

    for (const [suffix, publishedAt] of [
      ["company", "2026-08-07T10:00:00Z"],
      ["filing", "2026-08-07T11:00:00Z"],
    ] as const) {
      await watchRepository.recordObservation({
        sourceId: "source_financing_test",
        objectKey: `public-watch/source_financing_test/${suffix}`,
        contentType: "text/html",
        byteSize: 2_048,
        sha256: suffix === "company" ? "e".repeat(64) : "f".repeat(64),
        retrievedAt: publishedAt,
        sourceUrl: `https://northstar-robotics.example/news/series-c-${suffix}`,
        sourceTitle: `Northstar Robotics Series C ${suffix} report`,
        publishedAt,
        eventType: "financing_announced",
        observedFact: valuationEvidence,
        modelConfidencePpm: 940_000,
        financingFacts,
        fingerprint: suffix === "company" ? "1".repeat(64) : "2".repeat(64),
      });
    }

    const pendingAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const pendingGroup = pendingAlpha.signalReconciliations.find(
      (group) => group.id === "co_northstar:series-c",
    );
    expect(pendingGroup).toMatchObject({
      status: "corroborated",
      pendingReviewCount: 2,
      canCreateProposal: false,
    });
    if (pendingGroup === undefined) {
      throw new Error("Expected the synthetic Series C reconciliation.");
    }

    for (const eventId of pendingGroup.recommendedReviewEventIds) {
      await alphaRepository.reviewEvidence(
        "synthetic-access-subject",
        eventId,
        {
          decision: "scenario_only",
          rationale: "Use as reviewed synthetic scenario context.",
        },
      );
    }

    const reviewedAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const reviewedGroup = reviewedAlpha.signalReconciliations.find(
      (group) => group.id === pendingGroup.id,
    );
    const sandbox = reviewedAlpha.scenarios.find(
      (scenario) => scenario.id === "scn_sandbox",
    );
    expect(reviewedGroup).toMatchObject({
      pendingReviewCount: 0,
      canCreateProposal: true,
      proposedCompanyValuation: { amountMinor: 100_000_000_000 },
    });
    if (
      reviewedGroup === undefined ||
      sandbox === undefined ||
      sandbox.latestSnapshotId === null ||
      sandbox.latestSnapshotVersion === null
    ) {
      throw new Error("Expected a proposal-ready group and scenario version.");
    }

    const marksBefore = tableSnapshot(database, "marks");
    const snapshotsBefore = tableSnapshot(database, "forecast_snapshots");
    const proposal = await alphaRepository.createSignalUpdateProposal(
      "synthetic-access-subject",
      {
        groupId: reviewedGroup.id,
        reconciliationRevision: reviewedGroup.revision,
        scenarioId: sandbox.id,
        baseForecastSnapshotId: sandbox.latestSnapshotId,
        rationale: "Model the reviewed company valuation separately.",
      },
    );

    expect(proposal).toMatchObject({
      groupId: reviewedGroup.id,
      scenarioId: "scn_sandbox",
      baseForecastSnapshotVersion: sandbox.latestSnapshotVersion,
      proposedCompanyValuation: { amountMinor: 100_000_000_000 },
      isCurrent: true,
    });
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM signal_update_proposal_evidence WHERE proposal_id = ?",
        )
        .get(proposal.id),
    ).toEqual({ count: 2 });
    expect(tableSnapshot(database, "marks")).toBe(marksBefore);
    expect(tableSnapshot(database, "forecast_snapshots")).toBe(snapshotsBefore);

    await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/company-follow-up",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "9".repeat(64),
      retrievedAt: "2026-08-07T12:00:00Z",
      sourceUrl: "https://northstar-robotics.example/news/series-c-follow-up",
      sourceTitle: "Northstar Robotics Series C follow-up",
      publishedAt: "2026-08-07T12:00:00Z",
      eventType: "financing_announced",
      observedFact: valuationEvidence,
      modelConfidencePpm: 940_000,
      financingFacts,
      fingerprint: "3".repeat(64),
    });
    const changedSignalAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const changedSignalGroup = changedSignalAlpha.signalReconciliations.find(
      (group) => group.id === reviewedGroup.id,
    );
    expect(changedSignalGroup).toMatchObject({
      pendingReviewCount: 1,
      canCreateProposal: false,
    });
    expect(
      changedSignalAlpha.signalUpdateProposals.find(
        (candidate) => candidate.id === proposal.id,
      ),
    ).toMatchObject({ isCurrent: false });
    await expect(
      alphaRepository.createSignalUpdateProposal("synthetic-access-subject", {
        groupId: reviewedGroup.id,
        reconciliationRevision: reviewedGroup.revision,
        scenarioId: sandbox.id,
        baseForecastSnapshotId: sandbox.latestSnapshotId,
        rationale: "This stale signal request must not create a proposal.",
      }),
    ).rejects.toThrow("Signal reconciliation is stale");
    if (changedSignalGroup === undefined) {
      throw new Error("Expected the changed synthetic reconciliation.");
    }
    for (const eventId of changedSignalGroup.recommendedReviewEventIds) {
      await alphaRepository.reviewEvidence(
        "synthetic-access-subject",
        eventId,
        {
          decision: "scenario_only",
          rationale: "Review the synthetic follow-up report.",
        },
      );
    }
    const refreshedSignalAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    const refreshedSignalGroup =
      refreshedSignalAlpha.signalReconciliations.find(
        (group) => group.id === reviewedGroup.id,
      );
    expect(refreshedSignalGroup).toMatchObject({
      pendingReviewCount: 0,
      canCreateProposal: true,
    });
    if (refreshedSignalGroup === undefined) {
      throw new Error("Expected the reviewed synthetic reconciliation.");
    }

    await alphaRepository.saveScenario("synthetic-access-subject", {
      scenarioId: sandbox.id,
      assumptions: sandbox.assumptions.map((assumption) => ({
        id: assumption.id,
        key: assumption.key,
        value: assumption.value,
      })),
      changeNote: "Advance the synthetic sandbox version.",
    });
    const advancedAlpha = await alphaRepository.getAlphaData(
      "synthetic-access-subject",
    );
    expect(
      advancedAlpha.signalUpdateProposals.find(
        (candidate) => candidate.id === proposal.id,
      ),
    ).toMatchObject({ isCurrent: false });
    await expect(
      alphaRepository.createSignalUpdateProposal("synthetic-access-subject", {
        groupId: refreshedSignalGroup.id,
        reconciliationRevision: refreshedSignalGroup.revision,
        scenarioId: sandbox.id,
        baseForecastSnapshotId: sandbox.latestSnapshotId,
        rationale: "This stale request must not create another proposal.",
      }),
    ).rejects.toThrow("base scenario is stale");
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM signal_update_proposals")
        .get(),
    ).toEqual({ count: 1 });
  });

  it("rejects financing facts on a non-financing event", () => {
    expect(() =>
      PortfolioWatchObservationInputSchema.parse({
        sourceId: "source_financing_test",
        objectKey: "public-watch/source_financing_test/document-sha",
        contentType: "text/html",
        byteSize: 4_096,
        sha256: "a".repeat(64),
        retrievedAt: "2026-08-07T12:00:00Z",
        sourceUrl: "https://northstar-robotics.example/news/update",
        sourceTitle: "Northstar Robotics update",
        publishedAt: "2026-08-07T10:00:00Z",
        eventType: "company_update",
        observedFact: "Northstar Robotics shared an update.",
        modelConfidencePpm: 940_000,
        financingFacts: {
          roundType: null,
          roundLabel: null,
          instrument: "equity",
          announcedAmount: null,
          companyValuation: null,
          ambiguities: [],
        },
        fingerprint: "b".repeat(64),
      }),
    ).toThrow("Only financing announcements");
  });

  it("rejects financing evidence excerpts unrelated to the retained observation", () => {
    expect(() =>
      PortfolioWatchObservationInputSchema.parse({
        sourceId: "source_financing_test",
        objectKey: "public-watch/source_financing_test/document-sha",
        contentType: "text/html",
        byteSize: 4_096,
        sha256: "a".repeat(64),
        retrievedAt: "2026-08-07T12:00:00Z",
        sourceUrl: "https://northstar-robotics.example/news/series-b",
        sourceTitle: "Northstar Robotics announces Series B",
        publishedAt: "2026-08-07T10:00:00Z",
        eventType: "financing_announced",
        observedFact:
          "Northstar Robotics announced a Series B financing with terms to be reviewed.",
        modelConfidencePpm: 940_000,
        financingFacts: {
          roundType: "series",
          roundLabel: "Series B",
          instrument: "equity",
          announcedAmount: {
            amountMinor: 125_000_000_00,
            currency: "USD",
            qualifier: "exact",
            evidenceText: "An unrelated company raised US$125 million.",
          },
          companyValuation: null,
          ambiguities: [],
        },
        fingerprint: "b".repeat(64),
      }),
    ).toThrow(
      "Financing evidence text must appear in the retained source title or observed fact.",
    );
  });

  it("accepts a title-only amount using the parser's title punctuation", () => {
    const result = PortfolioWatchObservationInputSchema.safeParse({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/title-only-sha",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "c".repeat(64),
      retrievedAt: "2026-08-07T12:00:00Z",
      sourceUrl: "https://northstar-robotics.example/news/series-b",
      sourceTitle: "Northstar Robotics raises US$125 million",
      publishedAt: "2026-08-07T10:00:00Z",
      eventType: "financing_announced",
      observedFact: "The financing will support product development.",
      modelConfidencePpm: 940_000,
      financingFacts: {
        roundType: "series",
        roundLabel: "Series B",
        instrument: "equity",
        announcedAmount: {
          amountMinor: 125_000_000_00,
          currency: "USD",
          qualifier: "exact",
          evidenceText: "Northstar Robotics raises US$125 million.",
        },
        companyValuation: null,
        ambiguities: [],
      },
      fingerprint: "d".repeat(64),
    });

    expect(result.success).toBe(true);
  });

  it("hydrates valuation and bounded observation excerpt fallbacks", async () => {
    database = createTestDatabase();
    const d1 = new TestD1Database(database);
    const watchRepository = new D1PortfolioWatchRepository(
      d1 as unknown as D1Database,
    );
    const valuationEvidence =
      "The financing values Northstar Robotics at about US$900 million post-money.";
    const fallbackObservedFact =
      "Synthetic financing update adds operating runway and product investment while management continues hiring across engineering sales support finance legal security research design partnerships and customer success teams worldwide.";

    await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/valuation-sha",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "c".repeat(64),
      retrievedAt: "2026-08-07T12:01:00Z",
      sourceUrl: "https://northstar-robotics.example/news/growth-valuation",
      sourceTitle: "Northstar Robotics announces growth financing",
      publishedAt: "2026-08-07T10:01:00Z",
      eventType: "financing_announced",
      observedFact: valuationEvidence,
      modelConfidencePpm: 930_000,
      financingFacts: {
        roundType: "growth",
        roundLabel: "Growth financing",
        instrument: "equity",
        announcedAmount: null,
        companyValuation: {
          amountMinor: 900_000_000_00,
          currency: "USD",
          qualifier: "approximately",
          evidenceText: valuationEvidence,
          basis: "post_money",
        },
        ambiguities: [],
      },
      fingerprint: "c".repeat(64),
    });
    await watchRepository.recordObservation({
      sourceId: "source_financing_test",
      objectKey: "public-watch/source_financing_test/fallback-sha",
      contentType: "text/html",
      byteSize: 2_048,
      sha256: "d".repeat(64),
      retrievedAt: "2026-08-07T12:02:00Z",
      sourceUrl: "https://northstar-robotics.example/news/strategic-round",
      sourceTitle: "Northstar Robotics announces strategic financing",
      publishedAt: "2026-08-07T10:02:00Z",
      eventType: "financing_announced",
      observedFact: fallbackObservedFact,
      modelConfidencePpm: 920_000,
      financingFacts: {
        roundType: "strategic",
        roundLabel: "Strategic financing",
        instrument: "equity",
        announcedAmount: null,
        companyValuation: null,
        ambiguities: [],
      },
      fingerprint: "d".repeat(64),
    });

    const alphaData = await new D1AlphaRepository(
      d1 as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(
      alphaData.evidenceInbox.find(
        (item) =>
          item.headline === "Northstar Robotics announces growth financing",
      ),
    ).toMatchObject({
      sourceUrl: "https://northstar-robotics.example/news/growth-valuation",
      sourceExcerpt: valuationEvidence,
    });
    const fallbackItem = alphaData.evidenceInbox.find(
      (item) =>
        item.headline === "Northstar Robotics announces strategic financing",
    );
    expect(fallbackItem).toMatchObject({
      sourceUrl: "https://northstar-robotics.example/news/strategic-round",
      sourceExcerpt: fallbackObservedFact.split(/\s+/u).slice(0, 25).join(" "),
    });
    expect(fallbackItem?.sourceExcerpt?.split(/\s+/u)).toHaveLength(25);
    expect(fallbackItem?.sourceExcerpt?.length).toBeLessThanOrEqual(240);
  });

  it("does not hydrate mismatched legacy observation or claim provenance", async () => {
    database = createTestDatabase();
    database.exec(`
      INSERT INTO users (id, access_subject, email, display_name, created_at)
      VALUES ('user_other', 'other-subject', 'other@example.invalid', 'Other Demo', '2026-08-07T12:00:00Z');
      INSERT INTO households (id, owner_user_id, name, base_currency, created_at)
      VALUES ('hh_other', 'user_other', 'Other Demo', 'USD', '2026-08-07T12:00:00Z');
    `);
    database
      .prepare(
        `INSERT INTO evidence_claims (
           id, household_id, evidence_event_id, field_path, claim_value_json,
           unit, provenance, created_at
         ) VALUES (?, 'hh_other', 'evt_northstar_round',
           'company_event.financing_terms', ?, NULL, ?, ?)`,
      )
      .run(
        "claim_other_household",
        JSON.stringify({
          title: "Mismatched synthetic financing",
          publishedAt: "2026-08-07T10:00:00Z",
          sourceUrl: "https://northstar-robotics.example/news/mismatch",
          financingFacts: {
            roundType: "series",
            roundLabel: "Series C",
            instrument: "equity",
            announcedAmount: {
              amountMinor: 12_500_000_000,
              currency: "USD",
              qualifier: "exact",
              evidenceText: "Northstar Robotics raised US$125 million.",
            },
            companyValuation: null,
            ambiguities: [],
          },
        }),
        "Mismatched synthetic source",
        "2026-08-07T12:00:00Z",
      );
    database.exec(`
      INSERT INTO public_source_observations (
        id, household_id, company_id, evidence_event_id, source_document_id,
        source_class, source_url, source_title, published_at, retrieved_at,
        observed_fact, inference, source_reliability_ppm,
        model_confidence_ppm, valuation_low_minor, valuation_middle_minor,
        valuation_high_minor, limitations, fingerprint, created_at
      ) VALUES (
        'obs_other_household', 'hh_other', 'co_northstar',
        'evt_northstar_round', 'doc_northstar_update', 'official_company',
        'https://northstar-robotics.example/news/mismatch',
        'Mismatched synthetic financing', '2026-08-07T10:00:00Z',
        '2026-08-07T12:00:00Z',
        'Northstar Robotics raised US$125 million.',
        'Mismatched legacy observation.', 900000, 800000,
        NULL, NULL, NULL, 'Mismatched tenant provenance.',
        'legacy-mismatched-fingerprint', '2026-08-07T12:00:00Z'
      );
    `);

    const alphaData = await new D1AlphaRepository(
      new TestD1Database(database) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(
      alphaData.evidenceInbox.find((item) => item.id === "evt_northstar_round"),
    ).toMatchObject({
      financingFacts: null,
      sourceUrl: null,
      sourceExcerpt: null,
    });
  });

  it.each([
    {
      description: "after an earlier direct-value claim",
      financingCreatedAt: "2026-07-18T12:11:00-07:00",
    },
    {
      description: "before a later direct-value claim",
      financingCreatedAt: "2026-07-18T12:09:00-07:00",
    },
  ])(
    "refuses direct application when financing terms are recorded $description",
    async ({ financingCreatedAt }) => {
      database = createTestDatabase();
      database.exec(`
        INSERT INTO evidence_claims (
          id, household_id, evidence_event_id, field_path, claim_value_json,
          unit, provenance, created_at
        ) VALUES (
          'claim_ns_financing_integrity', 'hh_demo', 'evt_northstar_round',
          'company_event.financing_terms',
          '{"financingFacts":{"roundType":"series","roundLabel":"Series B","instrument":"equity","announcedAmount":null,"companyValuation":null,"ambiguities":[]}}',
          NULL, 'Synthetic financing terms', '${financingCreatedAt}'
        );
      `);
      const d1 = new TestD1Database(database);
      const alphaRepository = new D1AlphaRepository(
        d1 as unknown as D1Database,
      );
      const marksBefore = tableSnapshot(database, "marks");
      const decisionsBefore = tableSnapshot(database, "review_decisions");
      const applicationsBefore = tableSnapshot(
        database,
        "evidence_applications",
      );
      const alphaData = await alphaRepository.getAlphaData(
        "synthetic-access-subject",
      );
      expect(
        alphaData.evidenceInbox.find(
          (item) => item.id === "evt_northstar_round",
        ),
      ).toMatchObject({
        application: null,
        sourceUrl: null,
        sourceExcerpt: null,
      });

      await expect(
        alphaRepository.applyEvidence(
          "synthetic-access-subject",
          "evt_northstar_round",
        ),
      ).rejects.toThrow("no deterministic direct application");

      expect(tableSnapshot(database, "marks")).toBe(marksBefore);
      expect(tableSnapshot(database, "review_decisions")).toBe(decisionsBefore);
      expect(tableSnapshot(database, "evidence_applications")).toBe(
        applicationsBefore,
      );
    },
  );
});
