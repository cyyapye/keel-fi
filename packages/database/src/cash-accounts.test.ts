import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NormalizedCashAccounts } from "@keel/connectors";

import { D1CashAccountsRepository } from "./cash-accounts";

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
  "packages/database/migrations/0010_public_holdings.sql",
  "packages/database/migrations/0011_portfolio_baselines.sql",
  "packages/database/migrations/0012_append_only_cash_flow_plans.sql",
  "packages/database/migrations/0013_plaid_holdings_webhooks.sql",
  "packages/database/migrations/0014_robinhood_auto_adjudication.sql",
  "packages/database/migrations/0015_reviewed_cash_accounts.sql",
  "packages/database/migrations/0016_reviewed_liabilities.sql",
  "packages/database/migrations/0017_reviewed_cash_flow.sql",
  "packages/database/migrations/0018_reviewed_cash_account_identities.sql",
  "packages/database/migrations/0025_retired_asset_lots.sql",
  "packages/database/migrations/0046_reviewed_legal_entity_inventory.sql",
  "packages/database/migrations/0033_provider_portfolio_agents.sql",
  "packages/database/migrations/0047_provider_legal_document_evidence.sql",
  "packages/database/migrations/0048_private_document_access.sql",
  "packages/database/migrations/0049_legal_name_resolutions.sql",
  "packages/database/migrations/0050_agreement_rechecks.sql",
  "packages/database/seed/synthetic.sql",
] as const;

class TestD1Statement {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: readonly SQLInputValue[] = [],
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    return new TestD1Statement(this.database, this.sql, values);
  }

  public first<T>(): Promise<T | null> {
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...this.values) as T) ?? null,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    });
  }

  public run(): Promise<{ meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  public execute(): void {
    this.database.prepare(this.sql).run(...this.values);
  }
}

class TestD1Database {
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    this.database.exec("BEGIN");
    try {
      statements.forEach((statement) => statement.execute());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }
}

function normalized(
  rows: NormalizedCashAccounts["rows"],
  observedAt = "2026-08-14T18:00:00.000Z",
): NormalizedCashAccounts {
  return {
    normalizedFingerprint: "f".repeat(64),
    observedAt,
    rows,
  };
}

function reportedRow(
  overrides: Partial<NormalizedCashAccounts["rows"][number]> = {},
) {
  return {
    naturalKeySha256: "a".repeat(64),
    itemAccountKeySha256: "a".repeat(64),
    institutionLabel: "First Synthetic Bank",
    accountLabel: "Household checking",
    subtype: "checking" as const,
    availableMinor: 120_000,
    currentMinor: 125_000,
    valueMinor: 120_000,
    valueState: "reported" as const,
    balanceSource: "available" as const,
    observedAt: "2026-08-14T18:00:00.000Z",
    issues: [],
    ...overrides,
  };
}

async function acceptOpaqueIdentityRotation(
  repository: D1CashAccountsRepository,
) {
  const priorNaturalKeySha256 = "a".repeat(64);
  const reportedNaturalKeySha256 = "b".repeat(64);
  const connection = await repository.upsertConnection(
    "synthetic-access-subject",
    "First Synthetic Bank",
    "connector-secrets/synthetic-cash.enc",
    "c".repeat(64),
  );
  const initial = await repository.beginRefresh(
    "synthetic-access-subject",
    connection.id,
    "initial",
  );
  const initialProposal = (
    await repository.stageProposal("synthetic-access-subject", initial.id, {
      objectKey: "cash-observations/synthetic-opaque-initial.json",
      sourceSha256: "d".repeat(64),
      normalized: normalized([
        reportedRow({
          naturalKeySha256: priorNaturalKeySha256,
          itemAccountKeySha256: priorNaturalKeySha256,
        }),
      ]),
    })
  ).proposal;
  if (initialProposal === null) {
    throw new Error("Expected the initial opaque-identity proposal.");
  }
  await repository.completeRefresh(
    "synthetic-access-subject",
    initial.id,
    initialProposal.id,
    1,
  );
  await repository.applyProposal(
    "synthetic-access-subject",
    initialProposal.id,
    {
      changeNote: "Accepted the initial synthetic account.",
      decisions: initialProposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    },
  );

  const live = await repository.beginRefresh(
    "synthetic-access-subject",
    connection.id,
    "live",
  );
  const liveObservedAt = "2026-08-15T18:00:00.000Z";
  const liveProposal = (
    await repository.stageProposal("synthetic-access-subject", live.id, {
      objectKey: "cash-observations/synthetic-opaque-live.json",
      sourceSha256: "e".repeat(64),
      normalized: normalized(
        [
          reportedRow({
            naturalKeySha256: reportedNaturalKeySha256,
            itemAccountKeySha256: reportedNaturalKeySha256,
            valueMinor: 130_000,
            availableMinor: 130_000,
            currentMinor: 135_000,
            observedAt: liveObservedAt,
          }),
        ],
        liveObservedAt,
      ),
    })
  ).proposal;
  if (liveProposal === null) {
    throw new Error("Expected the rotated opaque-identity proposal.");
  }
  await repository.completeRefresh(
    "synthetic-access-subject",
    live.id,
    liveProposal.id,
    1,
  );
  await repository.applyProposal("synthetic-access-subject", liveProposal.id, {
    changeNote: "Accepted the reported and missing synthetic records.",
    decisions: liveProposal.rows.map((row) => ({
      rowId: row.id,
      decision: "accepted",
    })),
  });
  return {
    connection,
    priorNaturalKeySha256,
    reportedNaturalKeySha256,
  };
}

describe("reviewed cash accounts", () => {
  let sqlite: DatabaseSync;
  let repository: D1CashAccountsRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    repository = new D1CashAccountsRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    );
  });

  afterEach(() => sqlite.close());

  it("stages provider facts without changing the plan, then applies explicit row decisions", async () => {
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({ status: "disconnected" });
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "1".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const forecastCountBefore = sqlite
      .prepare("SELECT COUNT(*) AS count FROM forecast_snapshots")
      .get() as { count: number };
    const planCountBefore = sqlite
      .prepare("SELECT COUNT(*) AS count FROM cash_flow_plans")
      .get() as { count: number };
    const staged = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "cash-observations/synthetic-one.json",
        sourceSha256: "2".repeat(64),
        normalized: normalized([
          reportedRow(),
          reportedRow({
            naturalKeySha256: "b".repeat(64),
            itemAccountKeySha256: "b".repeat(64),
            accountLabel: "Foreign cash",
            availableMinor: 10_000,
            currentMinor: 10_000,
            valueMinor: null,
            valueState: "unsupported",
            balanceSource: null,
            issues: ["Only USD cash balances are supported."],
          }),
        ]),
      },
    );
    expect(staged.proposal?.summary).toEqual({
      rowCount: 2,
      reportedCount: 1,
      needsAttentionCount: 1,
      notReportedCount: 0,
      totalReportedMinor: 120_000,
    });
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      staged.proposal?.id ?? null,
      2,
    );
    await expect(
      repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      ),
    ).rejects.toMatchObject({ code: "review_required" });
    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.pendingProposals).toHaveLength(1);
    expect(state.acceptedAccounts).toHaveLength(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get(),
    ).toEqual(forecastCountBefore);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM cash_flow_plans").get(),
    ).toEqual(planCountBefore);
    expect(
      sqlite
        .prepare("SELECT proposed_count FROM connector_sync_runs WHERE id = ?")
        .get(run.id),
    ).toEqual({ proposed_count: 2 });

    const proposal = state.pendingProposals[0];
    if (proposal === undefined) {
      throw new Error("Expected a pending cash proposal.");
    }
    await expect(
      repository.applyProposal("synthetic-access-subject", proposal.id, {
        changeNote: "Tried to accept an unsupported balance.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      }),
    ).rejects.toThrow("cannot be accepted");
    const result = await repository.applyProposal(
      "synthetic-access-subject",
      proposal.id,
      {
        changeNote: "Reviewed the synthetic cash balances.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision:
            row.valueState === "reported"
              ? ("accepted" as const)
              : ("excluded" as const),
        })),
      },
    );
    expect(result).toEqual({
      proposalId: proposal.id,
      acceptedCount: 1,
      excludedCount: 1,
      acceptedCashMinor: 120_000,
    });
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      pendingProposals: [],
      acceptedAccounts: [
        expect.objectContaining({
          accountLabel: "Household checking",
          valueMinor: 120_000,
          valueState: "reported",
          refreshKind: "initial",
        }),
      ],
    });

    const unchangedRun = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const unchanged = await repository.stageProposal(
      "synthetic-access-subject",
      unchangedRun.id,
      {
        objectKey: "cash-observations/synthetic-unchanged.json",
        sourceSha256: "3".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    expect(unchanged.proposal).toBeNull();
    await repository.completeRefresh(
      "synthetic-access-subject",
      unchangedRun.id,
      null,
      1,
    );
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({ pendingProposals: [] });
  });

  it("treats a missing account as unknown only after review", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "3".repeat(64),
    );
    const initial = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const first = await repository.stageProposal(
      "synthetic-access-subject",
      initial.id,
      {
        objectKey: "cash-observations/synthetic-initial.json",
        sourceSha256: "4".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    const firstProposal = first.proposal;
    if (firstProposal === null) {
      throw new Error("Expected the initial proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      firstProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      firstProposal.id,
      {
        changeNote: "Accepted initial synthetic checking.",
        decisions: firstProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const live = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const missing = await repository.stageProposal(
      "synthetic-access-subject",
      live.id,
      {
        objectKey: "cash-observations/synthetic-missing.json",
        sourceSha256: "5".repeat(64),
        normalized: normalized([]),
      },
    );
    expect(missing.proposal?.rows[0]).toMatchObject({
      action: "not_reported",
      valueMinor: null,
      valueState: "not_reported",
      priorValueMinor: 120_000,
    });
    const beforeReview = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(beforeReview.acceptedAccounts[0]?.valueMinor).toBe(120_000);
    const missingProposal = missing.proposal;
    if (missingProposal === null) {
      throw new Error("Expected the missing-account proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      live.id,
      missingProposal.id,
      0,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      missingProposal.id,
      {
        changeNote: "Confirmed the account was not reported.",
        decisions: missingProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      acceptedAccounts: [
        expect.objectContaining({
          valueMinor: null,
          valueState: "not_reported",
        }),
      ],
    });
  });

  it("keeps one lineage when Plaid changes the natural identity but preserves the Item account identity", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "3".repeat(64),
    );
    const initial = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const initialProposal = (
      await repository.stageProposal("synthetic-access-subject", initial.id, {
        objectKey: "cash-observations/synthetic-identity-initial.json",
        sourceSha256: "4".repeat(64),
        normalized: normalized([
          reportedRow({
            naturalKeySha256: "a".repeat(64),
            itemAccountKeySha256: "c".repeat(64),
          }),
        ]),
      })
    ).proposal;
    if (initialProposal === null) {
      throw new Error("Expected the initial identity proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      initialProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      initialProposal.id,
      {
        changeNote: "Accepted the initial synthetic account identity.",
        decisions: initialProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const live = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const liveObservedAt = "2026-08-15T18:00:00.000Z";
    const liveProposal = (
      await repository.stageProposal("synthetic-access-subject", live.id, {
        objectKey: "cash-observations/synthetic-identity-live.json",
        sourceSha256: "5".repeat(64),
        normalized: normalized(
          [
            reportedRow({
              naturalKeySha256: "b".repeat(64),
              itemAccountKeySha256: "c".repeat(64),
              availableMinor: 130_000,
              currentMinor: 135_000,
              valueMinor: 130_000,
              observedAt: liveObservedAt,
            }),
          ],
          liveObservedAt,
        ),
      })
    ).proposal;
    if (liveProposal === null) {
      throw new Error("Expected the live identity proposal.");
    }
    expect(liveProposal.rows).toEqual([
      expect.objectContaining({
        naturalKeySha256: "a".repeat(64),
        action: "update_balance",
        priorValueMinor: 120_000,
        valueMinor: 130_000,
      }),
    ]);
    await repository.completeRefresh(
      "synthetic-access-subject",
      live.id,
      liveProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      liveProposal.id,
      {
        changeNote: "Accepted the continued synthetic account identity.",
        decisions: liveProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.acceptedAccounts).toEqual([
      expect.objectContaining({
        naturalKeySha256: "a".repeat(64),
        valueMinor: 130_000,
        valueState: "reported",
      }),
    ]);
  });

  it("repairs an accepted reported/not-reported split when both lineages share the exact Item account identity", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    const initial = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const initialProposal = (
      await repository.stageProposal("synthetic-access-subject", initial.id, {
        objectKey: "cash-observations/synthetic-repair-initial.json",
        sourceSha256: "7".repeat(64),
        normalized: normalized([
          reportedRow({
            naturalKeySha256: "a".repeat(64),
            itemAccountKeySha256: "c".repeat(64),
          }),
        ]),
      })
    ).proposal;
    if (initialProposal === null) {
      throw new Error("Expected the repair fixture's initial proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      initialProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      initialProposal.id,
      {
        changeNote: "Accepted the repair fixture's initial account.",
        decisions: initialProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );
    const initialDecision = sqlite
      .prepare(
        `SELECT decided_at
         FROM cash_balance_review_decisions
         WHERE proposal_id = ?`,
      )
      .get(initialProposal.id) as { decided_at: string } | undefined;
    if (initialDecision === undefined) {
      throw new Error("Expected the repair fixture's initial decision.");
    }

    const live = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const proposalId = "cash_proposal_identity_split";
    const reportedRowId = "cash_row_identity_reported";
    const missingRowId = "cash_row_identity_missing";
    const observedAt = "2026-08-15T18:00:00.000Z";
    const decidedAt = new Date(
      Date.parse(initialDecision.decided_at) + 1,
    ).toISOString();
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposals (
           id, household_id, connector_account_id, sync_run_id,
           source_object_key, source_sha256, normalized_fingerprint,
           refresh_kind, observed_at, retrieved_at, status, created_at
         ) VALUES (?, 'hh_demo', ?, ?, ?, ?, ?, 'live', ?, ?,
                   'pending_review', ?)`,
      )
      .run(
        proposalId,
        connection.id,
        live.id,
        "cash-observations/synthetic-identity-split.json",
        "8".repeat(64),
        "9".repeat(64),
        observedAt,
        observedAt,
        observedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposal_rows (
           id, household_id, proposal_id, natural_key_sha256,
           item_account_key_sha256, institution_label, account_label, subtype,
           available_minor, current_minor, value_minor, value_state,
           balance_source, observed_at, issues_json, created_at
         ) VALUES (?, 'hh_demo', ?, ?, ?, 'First Synthetic Bank',
                   'Household checking', 'checking', 130000, 135000, 130000,
                   'reported', 'available', ?, '[]', ?)`,
      )
      .run(
        reportedRowId,
        proposalId,
        "b".repeat(64),
        "c".repeat(64),
        observedAt,
        observedAt,
      );
    sqlite
      .prepare(
        `INSERT INTO cash_balance_proposal_rows (
           id, household_id, proposal_id, natural_key_sha256,
           item_account_key_sha256, institution_label, account_label, subtype,
           available_minor, current_minor, value_minor, value_state,
           balance_source, observed_at, issues_json, created_at
         ) VALUES (?, 'hh_demo', ?, ?, NULL, 'First Synthetic Bank',
                   'Household checking', 'checking', NULL, NULL, NULL,
                   'not_reported', NULL, ?, ?, ?)`,
      )
      .run(
        missingRowId,
        proposalId,
        "a".repeat(64),
        observedAt,
        JSON.stringify([
          "This account was not reported in the latest balance check.",
        ]),
        observedAt,
      );
    const decision = sqlite.prepare(
      `INSERT INTO cash_balance_review_decisions (
         id, household_id, proposal_id, proposal_row_id, reviewer_user_id,
         decision, change_note, decided_at, immutable
       ) VALUES (?, 'hh_demo', ?, ?, 'usr_demo', 'accepted', ?, ?, 1)`,
    );
    decision.run(
      "cash_decision_identity_reported",
      proposalId,
      reportedRowId,
      "Accepted the replacement identity.",
      decidedAt,
    );
    decision.run(
      "cash_decision_identity_missing",
      proposalId,
      missingRowId,
      "Accepted the missing prior identity.",
      decidedAt,
    );
    sqlite
      .prepare(
        "UPDATE cash_balance_proposals SET status = 'applied' WHERE id = ?",
      )
      .run(proposalId);

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.acceptedAccounts).toEqual([
      expect.objectContaining({
        naturalKeySha256: "a".repeat(64),
        valueMinor: 130_000,
        valueState: "reported",
      }),
    ]);
  });

  it("keeps identically named accounts separate when their provider identities differ", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "a".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const proposal = (
      await repository.stageProposal("synthetic-access-subject", run.id, {
        objectKey: "cash-observations/synthetic-same-label.json",
        sourceSha256: "b".repeat(64),
        normalized: normalized([
          reportedRow({
            naturalKeySha256: "c".repeat(64),
            itemAccountKeySha256: "d".repeat(64),
          }),
          reportedRow({
            naturalKeySha256: "e".repeat(64),
            itemAccountKeySha256: "f".repeat(64),
            valueMinor: 80_000,
          }),
        ]),
      })
    ).proposal;
    if (proposal === null) {
      throw new Error("Expected the same-label proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      proposal.id,
      2,
    );
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote: "Accepted both distinct synthetic accounts.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    });

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.acceptedAccounts).toHaveLength(2);
    expect(
      new Set(state.acceptedAccounts.map((account) => account.naturalKeySha256))
        .size,
    ).toBe(2);
  });

  it("requires review before linking a one-to-one opaque account rotation", async () => {
    const rotation = await acceptOpaqueIdentityRotation(repository);
    const beforeReview = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(beforeReview.acceptedAccounts).toHaveLength(2);
    expect(beforeReview.identityCandidates).toEqual([
      expect.objectContaining({
        connectionId: rotation.connection.id,
        accountLabel: "Household checking",
        priorNaturalKeySha256: rotation.priorNaturalKeySha256,
        reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
      }),
    ]);

    await repository.reviewIdentity("synthetic-access-subject", {
      connectionId: rotation.connection.id,
      priorNaturalKeySha256: rotation.priorNaturalKeySha256,
      reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
      decision: "same_account",
      changeNote: "Confirmed the synthetic records describe one account.",
    });

    const afterReview = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(afterReview.identityCandidates).toEqual([]);
    expect(afterReview.acceptedAccounts).toEqual([
      expect.objectContaining({
        naturalKeySha256: rotation.priorNaturalKeySha256,
        valueMinor: 130_000,
        valueState: "reported",
      }),
    ]);
    expect(() =>
      sqlite
        .prepare(
          "UPDATE cash_account_identity_decisions SET decision = 'separate_accounts'",
        )
        .run(),
    ).toThrow("cash account identity decisions are immutable");
    await expect(
      repository.reviewIdentity("synthetic-access-subject", {
        connectionId: rotation.connection.id,
        priorNaturalKeySha256: rotation.priorNaturalKeySha256,
        reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
        decision: "same_account",
        changeNote: "Tried to repeat a stale synthetic review.",
      }),
    ).rejects.toMatchObject({ code: "review_required" });
  });

  it("records a reviewed decision to keep opaque account identities separate", async () => {
    const rotation = await acceptOpaqueIdentityRotation(repository);
    await repository.reviewIdentity("synthetic-access-subject", {
      connectionId: rotation.connection.id,
      priorNaturalKeySha256: rotation.priorNaturalKeySha256,
      reportedNaturalKeySha256: rotation.reportedNaturalKeySha256,
      decision: "separate_accounts",
      changeNote: "Confirmed the synthetic records are separate accounts.",
    });

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.identityCandidates).toEqual([]);
    expect(state.acceptedAccounts).toHaveLength(2);
  });

  it("counts every live provider attempt and enforces the monthly ceiling", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    for (let index = 0; index < 4; index += 1) {
      const run = await repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      );
      await repository.failRefresh(
        "synthetic-access-subject",
        run.id,
        "provider_unavailable",
      );
    }

    await expect(
      repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      ),
    ).rejects.toMatchObject({
      code: "monthly_limit_reached",
    });
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      connections: [
        expect.objectContaining({
          liveRefreshesUsed: 4,
          liveRefreshesRemaining: 0,
        }),
      ],
    });
  });

  it("starts an automatic live check only when the weekly guard allows it", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    const refreshedAfter = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1_000,
    ).toISOString();
    const first = await repository.beginAutomaticRefresh(
      "synthetic-access-subject",
      connection.id,
      refreshedAfter,
    );
    expect(first).toMatchObject({ refreshKind: "live" });
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        refreshedAfter,
      ),
    ).resolves.toBeNull();
    if (first === null) {
      throw new Error("Expected an automatic live refresh run.");
    }
    await repository.failRefresh(
      "synthetic-access-subject",
      first.id,
      "provider_unavailable",
    );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        refreshedAfter,
      ),
    ).resolves.toBeNull();

    sqlite
      .prepare("UPDATE connector_sync_runs SET started_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString(),
        first.id,
      );
    await expect(
      repository.beginAutomaticRefresh(
        "synthetic-access-subject",
        connection.id,
        refreshedAfter,
      ),
    ).resolves.toMatchObject({ refreshKind: "live" });
  });

  it("guards cash observations and decisions against rewriting", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "7".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const staged = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "cash-observations/synthetic-immutable.json",
        sourceSha256: "8".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    const proposal = staged.proposal;
    if (proposal === null) {
      throw new Error("Expected a proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      proposal.id,
      1,
    );
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote: "Accepted immutable synthetic cash.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    });

    expect(() =>
      sqlite
        .prepare(
          "UPDATE cash_balance_proposal_rows SET account_label = 'Changed'",
        )
        .run(),
    ).toThrow("cash proposal rows are immutable");
    expect(() =>
      sqlite.prepare("DELETE FROM cash_balance_review_decisions").run(),
    ).toThrow("cash review decisions are immutable");
  });
});
