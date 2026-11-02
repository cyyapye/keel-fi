import { expect, it, vi } from "vitest";
import { D1ManualHoldingRepository } from "../packages/database/src/manual-holdings";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import { measureD1 } from "./test-support/d1-cost";
import { createManualHoldingsCostDatabase } from "./test-support/manual-holdings-cost-database";
import { ManualHoldingInputSchema } from "../packages/domain/src/manual-holdings";

const subject = "synthetic-access-subject";
const time = "2026-11-01T00:00:00.000Z";

it("bounds manual options and current identities with 120 items, tied history and unrelated households", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(time));
  const fixture = await createManualHoldingsCostDatabase();
  try {
    const database = fixture.database;
    await database.batch(
      ["empty", "unrelated"].flatMap((name) => [
        database
          .prepare(
            "INSERT INTO users(id,access_subject,email,display_name,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(
            `manual-cost-user-${name}`,
            `manual-cost-${name}`,
            `manual-cost-${name}@example.test`,
            "Synthetic Cost User",
            time,
          ),
        database
          .prepare(
            "INSERT INTO households(id,owner_user_id,name,base_currency,created_at) VALUES(?,?,?,'USD',?)",
          )
          .bind(
            `manual-cost-hh-${name}`,
            `manual-cost-user-${name}`,
            "Synthetic Cost Household",
            time,
          ),
      ]),
    );
    const measured = measureD1(database);
    const repository = new D1ManualHoldingRepository(measured.database, {
      put: () => Promise.resolve(undefined),
    });
    const positions = new D1InvestmentPositionViewRepository(measured.database);
    const company = (await repository.options(subject)).companies[0]!;
    measured.reset();
    const input = (accessSubject: string, index: number) =>
      ManualHoldingInputSchema.parse({
        submissionId: crypto.randomUUID(),
        classification: "private_paper",
        name: `Synthetic Cost Investment ${index}`,
        kind:
          index % 3 === 0
            ? "direct"
            : index % 3 === 1
              ? "spv_interest"
              : "fund_interest",
        owner: { mode: "new", label: `Synthetic Cost Owner ${index}` },
        company:
          accessSubject === subject
            ? {
                mode: "existing",
                companyId: company.id,
                revision: company.revision,
              }
            : { mode: "unassigned" },
        cashPaidMinor: null,
        investmentDate: null,
        valuation: { state: "unknown" },
      });
    const acceptanceCost = await fixture.createManualHoldings({
      subject,
      time,
      inputs: Array.from({ length: 120 }, (_, index) => input(subject, index)),
    });
    expect(acceptanceCost.rowsWritten).toBeGreaterThan(120 * 20);
    expect(acceptanceCost.rowsRead).toBeLessThanOrEqual(120 * 200);
    expect(acceptanceCost.rowsWritten).toBeLessThanOrEqual(120 * 125);
    expect(acceptanceCost.roundTrips).toBe(120 * 8);
    const read = async (accessSubject: string, household: string) => {
      measured.reset();
      const options = await repository.options(accessSubject);
      const view = await positions.listForHousehold(household, time);
      const cost = { ...measured.cost };
      expect(cost.roundTrips).toBe(5);
      expect(cost.statements).toBe(7);
      expect(cost.rowsWritten).toBe(0);
      expect(cost.rowsRead).toBeLessThanOrEqual(6_000);
      return { options, view, cost };
    };
    const before = await read(subject, "hh_demo");
    const target = before.view.connections.flatMap((connection) =>
      connection.containers.flatMap((container) => container.positions),
    )[0]!;
    const history = new D1PositionPurchaseRepository(measured.database);
    measured.reset();
    const initialHistory = await history.history(subject, target.id);
    const initialHistoryCost = { ...measured.cost };
    expect(initialHistory.entries).toHaveLength(1);
    expect(
      initialHistory.entries.some((entry) => entry.kind === "identity"),
    ).toBe(true);
    measured.reset();
    expect(
      (await history.history("manual-cost-empty", target.id)).entries,
    ).toEqual([]);
    const foreignHistoryBefore = { ...measured.cost };
    expect(foreignHistoryBefore).toMatchObject({
      roundTrips: 1,
      statements: 1,
      rowsWritten: 0,
    });
    expect(foreignHistoryBefore.rowsRead).toBeLessThanOrEqual(16);
    expect(before.options.containers).toHaveLength(120);
    const emptyBefore = await read("manual-cost-empty", "manual-cost-hh-empty");
    expect(emptyBefore.options.containers).toEqual([]);
    expect(emptyBefore.view.connections).toEqual([]);

    for (let version = 2; version <= 121; version++) {
      await database.batch([
        database
          .prepare(
            `INSERT INTO investment_connection_versions
          (id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
          SELECT connection_id||'_cost_v'||?,household_id,connection_id,version+1,institution_key,institution_label,lifecycle_state,credential_reference,id,recorded_by_user_id,?,1
          FROM investment_connection_versions WHERE household_id='hh_demo' AND institution_key='manual' AND version=?`,
          )
          .bind(version, time, version - 1),
        database
          .prepare(
            `INSERT INTO ownership_container_versions
          (id,household_id,container_id,version,display_label,container_kind,tax_treatment,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
          SELECT container_id||'_cost_v'||?,household_id,container_id,version+1,display_label,container_kind,tax_treatment,id,recorded_by_user_id,?,1
          FROM ownership_container_versions WHERE household_id='hh_demo' AND container_id LIKE 'manual_container_%' AND version=?`,
          )
          .bind(version, time, version - 1),
        database
          .prepare(
            `INSERT INTO source_documents
          (id,household_id,object_key,file_name,content_type,byte_size,sha256,effective_date,retrieved_at,source_label,review_status,created_at)
          SELECT 'cost_manual_doc_'||v.position_id||'_'||?,v.household_id,'synthetic-manual-history/'||v.position_id||'/'||?,
            'synthetic.json','application/json',2,printf('%064x',? * 1000 + ROW_NUMBER() OVER (ORDER BY v.position_id)),NULL,?,'Entered by you','accepted',?
          FROM manual_holding_identity_heads h JOIN manual_holding_identity_versions v ON v.id=h.version_id WHERE h.household_id='hh_demo'`,
          )
          .bind(version, version, version, time, time),
        database
          .prepare(
            `INSERT INTO manual_holding_identity_versions
          (id,household_id,position_id,container_id,legal_vehicle_name,owner_label,position_kind,opened_on,classification,version,prior_id,source_document_id,prior_company_mapping_ids_json,recorded_by_user_id,recorded_at,immutable)
          SELECT v.position_id||'_cost_identity_'||?,v.household_id,v.position_id,v.container_id,v.legal_vehicle_name,v.owner_label,v.position_kind,v.opened_on,v.classification,v.version+1,v.id,
            'cost_manual_doc_'||v.position_id||'_'||?,(SELECT json_group_array(mapping_id) FROM holding_position_exposure_heads WHERE household_id=v.household_id AND position_id=v.position_id AND status='active'),v.recorded_by_user_id,v.recorded_at,1
          FROM manual_holding_identity_heads h JOIN manual_holding_identity_versions v ON v.id=h.version_id WHERE h.household_id='hh_demo'`,
          )
          .bind(version, version),
        database
          .prepare(
            `INSERT INTO holding_position_exposure_mappings
          (id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
          SELECT m.position_id||'_cost_mapping_'||CAST(? AS INTEGER),m.household_id,m.position_id,m.exposure_id,m.relationship_kind,m.allocation_ppm,m.status,'review','Synthetic tied mapping correction',m.evidence_sha256,?,m.version+1,m.id,m.accepted_by_user_id,?,1
          FROM holding_position_exposure_heads head JOIN holding_position_exposure_mappings m ON m.id=head.mapping_id WHERE head.household_id='hh_demo' AND head.status='active'`,
          )
          .bind(version, time, time),
      ]);
    }
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) n FROM manual_holding_identity_versions WHERE household_id='hh_demo'",
        )
        .first<number>("n"),
    ).toBe(14_520);
    const after = await read(subject, "hh_demo");
    expect(
      after.options.containers.map(({ id, label }) => ({ id, label })),
    ).toEqual(
      before.options.containers.map(({ id, label }) => ({ id, label })),
    );
    expect(after.options.containers.every((row) => row.version === 121)).toBe(
      true,
    );
    const projected = after.view.connections.flatMap((connection) =>
      connection.containers.flatMap((container) => container.positions),
    );
    expect(projected).toHaveLength(120);
    expect(
      projected.every((position) => position.manualContext?.version === 121),
    ).toBe(true);
    for (const position of projected) {
      expect(position.manualContext?.companyMappingIds).toEqual([
        `${position.id}_cost_mapping_121`,
      ]);
    }
    expect(after.cost.rowsRead).toBeLessThanOrEqual(
      before.cost.rowsRead + 2_000,
    );
    const emptyAfter = await read("manual-cost-empty", "manual-cost-hh-empty");
    expect(emptyAfter).toEqual(emptyBefore);
    measured.reset();
    const historyPage = await history.history(subject, target.id);
    const historyCost = { ...measured.cost };
    expect(historyPage.entries).toHaveLength(30);
    expect(historyPage.next).not.toBeNull();
    expect(historyCost).toMatchObject({
      roundTrips: 1,
      statements: 1,
      rowsWritten: 0,
    });
    expect(historyCost.rowsRead).toBeLessThanOrEqual(1_000);
    measured.reset();
    const earlier = await history.history(
      subject,
      target.id,
      historyPage.next!,
    );
    expect(earlier.entries).toHaveLength(30);
    expect(
      earlier.entries.some((entry) =>
        historyPage.entries.some(
          (latest) =>
            latest.kind === entry.kind &&
            latest.receipt.id === entry.receipt.id,
        ),
      ),
    ).toBe(false);
    expect(measured.cost).toMatchObject({
      roundTrips: 1,
      statements: 1,
      rowsWritten: 0,
    });
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(1_000);
    measured.reset();
    expect(
      (await history.history("manual-cost-empty", target.id)).entries,
    ).toEqual([]);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(
      foreignHistoryBefore.rowsRead,
    );

    const unrelatedInputs = Array.from({ length: 120 }, (_, index) =>
      input("manual-cost-unrelated", index),
    );
    await fixture.createManualHoldings({
      subject: "manual-cost-unrelated",
      time,
      inputs: unrelatedInputs,
    });
    expect(
      await database
        .prepare(
          "SELECT COUNT(*) n FROM manual_holding_submissions WHERE household_id=? AND submission_id IN (SELECT value FROM json_each(?))",
        )
        .bind(
          "manual-cost-hh-unrelated",
          JSON.stringify(unrelatedInputs.map((value) => value.submissionId)),
        )
        .first<number>("n"),
    ).toBe(120);
    const unrelated = await read(subject, "hh_demo");
    expect(unrelated.options).toEqual(after.options);
    expect(unrelated.view).toEqual(after.view);
    expect(unrelated.cost.rowsRead).toBeLessThanOrEqual(
      after.cost.rowsRead + 100,
    );
    expect(
      (await read("manual-cost-empty", "manual-cost-hh-empty")).cost.rowsRead,
    ).toBeLessThanOrEqual(emptyBefore.cost.rowsRead + 100);
    measured.reset();
    expect(
      (await history.history("manual-cost-empty", target.id)).entries,
    ).toEqual([]);
    expect(measured.cost).toEqual(foreignHistoryBefore);

    const optionsSql = [...measured.queries].find((sql) =>
      sql.includes(
        "SELECT c.id,v.display_label label,v.version FROM ownership_containers c",
      ),
    );
    if (!optionsSql)
      throw new Error("Expected manual-owner options projection");
    const plan = (
      await database
        .prepare(`EXPLAIN QUERY PLAN ${optionsSql}`)
        .bind("hh_demo")
        .all<{ detail: string }>()
    ).results.map((row) => row.detail);
    expect(
      plan.some((detail) =>
        /SEARCH latest USING INDEX sqlite_autoindex_investment_connection_versions_\d+ \(connection_id=\?\)/u.test(
          detail,
        ),
      ),
    ).toBe(true);
    expect(
      plan.some((detail) =>
        /SEARCH latest USING INDEX sqlite_autoindex_ownership_container_versions_\d+ \(container_id=\?\)/u.test(
          detail,
        ),
      ),
    ).toBe(true);
    expect(
      plan.some((detail) => /SCAN (latest|origin|iv|v)\b/u.test(detail)),
    ).toBe(false);
    const positionSql = [...measured.queries].find((sql) =>
      sql.includes("AS manual_context_json"),
    );
    if (!positionSql)
      throw new Error("Expected current manual identity projection");
    const positionPlan = (
      await database
        .prepare(`EXPLAIN QUERY PLAN ${positionSql}`)
        .bind("hh_demo")
        .all<{ detail: string }>()
    ).results.map((row) => row.detail);
    expect(
      positionPlan.some(
        (detail) =>
          detail.includes("holding_exposure_heads_current_position_idx") &&
          detail.includes("household_id=? AND position_id=? AND status=?"),
      ),
    ).toBe(true);
    expect(
      positionPlan.some((detail) =>
        /SCAN (manual_identity|manual_head|mv|holding_position_exposure_heads)\b/u.test(
          detail,
        ),
      ),
    ).toBe(false);
    const historySql = [...measured.queries].find(
      (sql) =>
        sql.includes("WITH owned") &&
        !sql.includes("AND (r.accepted_at,r.id,?)"),
    );
    if (!historySql)
      throw new Error("Expected bounded identity history projection");
    const historyPlan = (
      await database
        .prepare(`EXPLAIN QUERY PLAN ${historySql}`)
        .bind(target.id, subject, target.id, target.id, target.id)
        .all<{ detail: string }>()
    ).results.map((row) => row.detail);
    expect(
      historyPlan.some(
        (detail) =>
          detail.includes("manual_holding_identity_versions_history_idx") &&
          detail.includes("household_id=? AND position_id=?"),
      ),
    ).toBe(true);
    expect(
      historyPlan.some((detail) =>
        /SCAN (r|identity_version|identity_prior|identity_submission)\b/u.test(
          detail,
        ),
      ),
    ).toBe(false);
    console.info(
      JSON.stringify({
        syntheticManualHoldingsCost: {
          acceptance: acceptanceCost,
          before: before.cost,
          history: after.cost,
          unrelated: unrelated.cost,
          empty: emptyBefore.cost,
          initialHistory: initialHistoryCost,
          identityHistory: historyCost,
          foreignHistory: foreignHistoryBefore,
          optionsPlan: plan,
          positionPlan,
          historyPlan,
        },
      }),
    );
  } finally {
    await fixture.close();
    vi.useRealTimers();
  }
}, 180_000);
